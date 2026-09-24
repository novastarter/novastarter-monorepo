/**
 * Tests of the Stripe driver: the resources stubbed on a real client, the webhooks signed the way Stripe signs them
 * and read from fixtures shaped like Stripe's current events. The mappings have their own tests beside their modules
 * (`to-event.test.ts`, `to-invoice.test.ts`, `to-subscription.test.ts`).
 */
import {
	HitRateLimitError,
	InvalidCredentialsError,
	InvalidPayloadError,
	ProviderCallError,
} from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import Stripe from 'stripe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixture } from '../fixtures/index.js';
import { PaymentsDriverStripe, PRORATION } from './driver.js';
import { toInvoice } from './to-invoice.js';

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'whsec_test_secret';

/**
 * A driver on a real client whose resources are stubbed — no network, real webhook verification.
 *
 * @returns The driver and the client to stub on.
 */
const setup = () => {
	// A real client, so `webhooks` verifies signatures for real; the resources are spied on per test, so nothing ever
	// reaches the network.
	const client = new Stripe('sk_test_x', { appInfo: { name: 'test' } });

	// The driver takes the client instead of building one, which is what the `client` option exists for.
	const driver = new PaymentsDriverStripe({ secretKey: 'sk_test_x', webhookSecret: WEBHOOK_SECRET, client });

	return { client, driver };
};

/**
 * Deliver a body through `parseWebhook`, signed with the given secret.
 *
 * @param driver - The driver under test.
 * @param body - The event object, or the raw text of a body that is not an event.
 * @param secret - The signing secret; the right one unless given.
 * @returns What `parseWebhook` answered.
 */
const deliver = (driver: PaymentsDriverStripe, body: Stripe.Event | string, secret = WEBHOOK_SECRET) => {
	// The signature covers the exact bytes, so the text is made once and used for both the header and the call.
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });

	// Headers arrive lower-cased, as the route hands them to the driver.
	return driver.parseWebhook(payload, { 'stripe-signature': header, 'content-type': 'application/json' });
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('PaymentsDriverStripe', () => {
	test('Refuses to start without a secret key or a webhook secret', () => {
		// Each missing value is named, so a misconfigured deployment says which option to set.
		expect(() => new PaymentsDriverStripe({ secretKey: '', webhookSecret: 'whsec' })).toThrow('"secretKey"');
		expect(() => new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test("Passes the application's appInfo to the client and nothing without one", () => {
		const named = new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: 'whsec', appInfo: { name: 'Acme' } });
		const anonymous = new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: 'whsec' });

		expect(named['client']._appInfo).toMatchObject({ name: 'Acme' });
		expect(anonymous['client']._appInfo).toBeUndefined();
	});

	test('Creates a customer with the organization in its metadata', async () => {
		const { client, driver } = setup();

		const create = vi.spyOn(client.customers, 'create').mockResolvedValue({
			id: 'cus_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		} as never);

		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({
			id: 'cus_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});

		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});
	});

	test('Starts a subscription checkout with the metadata on the session and on the subscription', async () => {
		const { client, driver } = setup();

		const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue({
			id: 'cs_1',
			url: 'https://checkout.stripe.com/c/pay/cs_1',
			expires_at: 1789171100,
		} as never);

		await expect(
			driver.createCheckoutSession({
				customerId: 'cus_1',
				priceId: 'price_pro_monthly',
				quantity: 3,
				successUrl: 'https://app/billing?ok',
				cancelUrl: 'https://app/billing/plans',
				trialDays: 14,
				allowPromotionCodes: true,
				metadata: { organizationId: 'org_42', planId: 'pro' },
			}),
		).resolves.toStrictEqual({
			id: 'cs_1',
			url: 'https://checkout.stripe.com/c/pay/cs_1',
			expiresAt: new Date(1789171100 * 1000),
		});

		// The metadata goes under `subscription_data` too, so the subscription's own events carry it.
		expect(create).toHaveBeenCalledWith({
			mode: 'subscription',
			customer: 'cus_1',
			line_items: [{ price: 'price_pro_monthly', quantity: 3 }],
			success_url: 'https://app/billing?ok',
			cancel_url: 'https://app/billing/plans',
			allow_promotion_codes: true,
			metadata: { organizationId: 'org_42', planId: 'pro' },
			subscription_data: { trial_period_days: 14, metadata: { organizationId: 'org_42', planId: 'pro' } },
		});

		create.mockResolvedValue({ id: 'cs_2', url: null, expires_at: 1 } as never);

		await expect(
			driver.createCheckoutSession({ customerId: 'c', priceId: 'p', successUrl: 's', cancelUrl: 'c' }),
		).rejects.toThrow('no URL');
	});

	test('Opens the portal', async () => {
		const { client, driver } = setup();

		const create = vi
			.spyOn(client.billingPortal.sessions, 'create')
			.mockResolvedValue({ url: 'https://billing.stripe.com/session/x' } as never);

		await expect(
			driver.createPortalSession({ customerId: 'cus_1', returnUrl: 'https://app/billing' }),
		).resolves.toStrictEqual({
			url: 'https://billing.stripe.com/session/x',
		});

		expect(create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app/billing' });
	});

	test('Reads, updates and cancels a subscription through its item', async () => {
		const { client, driver } = setup();
		const stripeSubscription = fixture('customer.subscription.created').data.object as Stripe.Subscription;

		const retrieve = vi.spyOn(client.subscriptions, 'retrieve').mockResolvedValue(stripeSubscription as never);
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(stripeSubscription as never);
		const cancel = vi.spyOn(client.subscriptions, 'cancel').mockResolvedValue(stripeSubscription as never);

		await expect(driver.getSubscription('sub_1S5abcDEF123456789')).resolves.toMatchObject({
			id: 'sub_1S5abcDEF123456789',
			status: 'trialing',
			quantity: 3,
		});

		// A change that needs a payment waits until it is paid, so a declined card leaves the old price in place.
		await driver.updateSubscription({
			subscriptionId: 'sub_1S5abcDEF123456789',
			priceId: 'price_business_monthly',
			quantity: 10,
			proration: 'invoice',
		});

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			items: [{ id: 'si_T1abcDEF12345', price: 'price_business_monthly', quantity: 10 }],
			proration_behavior: 'always_invoice',
			payment_behavior: 'pending_if_incomplete',
		});

		// Without a proration choice the kit prorates.
		await driver.updateSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', quantity: 4 });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			items: [{ id: 'si_T1abcDEF12345', quantity: 4 }],
			proration_behavior: PRORATION.prorate,
			payment_behavior: 'pending_if_incomplete',
		});

		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', reason: 'Too expensive' });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			cancel_at_period_end: true,
			cancellation_details: { comment: 'Too expensive' },
		});

		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', immediately: true });

		expect(cancel).toHaveBeenCalledWith('sub_1S5abcDEF123456789', {});

		await expect(driver.updateSubscription({ subscriptionId: 'sub_1S5abcDEF123456789' })).rejects.toThrow(
			'Nothing to update',
		);

		expect(retrieve).toHaveBeenCalledTimes(3);
	});

	test('Throws when the change waits in pending_update because its payment failed', async () => {
		// This is what Stripe answers when the invoice for a change sent with pending_if_incomplete is declined.
		const { client, driver } = setup();
		const stripeSubscription = fixture('customer.subscription.created').data.object as Stripe.Subscription;

		vi.spyOn(client.subscriptions, 'retrieve').mockResolvedValue(stripeSubscription as never);

		vi.spyOn(client.subscriptions, 'update').mockResolvedValue({
			...stripeSubscription,
			latest_invoice: 'in_1Declined',
			pending_update: {
				billing_cycle_anchor: null,
				expires_at: 1_700_000_000,
				subscription_items: [],
				trial_end: null,
				trial_from_plan: null,
			},
		} as never);

		// The unchanged subscription must not be answered as if the change was made.
		await expect(
			driver.updateSubscription({
				subscriptionId: 'sub_1S5abcDEF123456789',
				priceId: 'price_business_monthly',
				proration: 'invoice',
			}),
		).rejects.toThrow(
			'was not changed: the payment for the change failed, and the change waits in pending_update until invoice "in_1Declined" is paid',
		);
	});

	test('Lists invoices', async () => {
		const { client, driver } = setup();
		const invoice = fixture('invoice.paid').data.object as Stripe.Invoice;

		const list = vi.spyOn(client.invoices, 'list').mockResolvedValue({ data: [invoice] } as never);

		await expect(driver.listInvoices({ customerId: 'cus_T1abcDEF12345', limit: 10 })).resolves.toStrictEqual([
			toInvoice(invoice),
		]);

		expect(list).toHaveBeenCalledWith({ customer: 'cus_T1abcDEF12345', limit: 10 });

		// Leaving the limit out would let Stripe page at ten.
		await expect(driver.listInvoices({ customerId: 'cus_T1abcDEF12345' })).resolves.toStrictEqual([toInvoice(invoice)]);

		expect(list).toHaveBeenCalledWith({ customer: 'cus_T1abcDEF12345', limit: 20 });
	});

	test('Verifies a signed webhook and refuses a wrong signature, a missing header and a broken body', async () => {
		const { driver } = setup();
		const event = fixture('customer.subscription.created');

		await expect(deliver(driver, event)).resolves.toMatchObject({
			id: 'evt_1S5subCreated00001',
			type: 'subscription.created',
			provider: 'stripe',
		});

		await expect(deliver(driver, event, 'whsec_other')).rejects.toBeInstanceOf(InvalidCredentialsError);

		await expect(driver.parseWebhook(JSON.stringify(event), {})).rejects.toBeInstanceOf(InvalidPayloadError);

		const payload = JSON.stringify(event);
		const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

		await expect(driver.parseWebhook(`${payload} `, { 'stripe-signature': header })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		await expect(deliver(driver, '{not json')).rejects.toBeInstanceOf(InvalidPayloadError);
	});

	test('Refuses a signed body that is JSON but not a Stripe event', async () => {
		// The SDK only verifies and parses; without a shape check a signed `{"hello":1}` would be dropped as an event
		// of no interest and acknowledged with 200.
		const { driver } = setup();

		await expect(deliver(driver, '{"hello":1}')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '{"hello":1}')).rejects.toThrow('not a Stripe event');

		await expect(deliver(driver, 'null')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '"evt_1"')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '{"id":"evt_1","type":"invoice.paid"}')).rejects.toBeInstanceOf(InvalidPayloadError);

		// An event of a type the kit does not act on is still an event: dropped, not refused.
		await expect(deliver(driver, fixture('customer.subscription.trial_will_end'))).resolves.toBeNull();
	});

	test('Verifies the key with the cheapest read', async () => {
		const { client, driver } = setup();
		const list = vi.spyOn(client.customers, 'list').mockResolvedValue({ data: [] } as never);

		await driver.verify();

		expect(list).toHaveBeenCalledWith({ limit: 1 });
	});
});

describe('call', () => {
	/**
	 * A refusal as the SDK raises it: Stripe's `error` with the status and headers the SDK copies onto it.
	 *
	 * @param statusCode - The HTTP status.
	 * @param headers - The response headers.
	 * @returns The SDK's exception.
	 */
	const refusal = (statusCode: number, headers: Record<string, string> = {}) =>
		new Stripe.errors.StripeInvalidRequestError({
			type: 'invalid_request_error',
			code: 'resource_missing',
			message: 'No such payment_intent: pi_404',
			statusCode,
			headers,
			requestId: 'req_1',
		});

	test('Exposes the SDK client it was given', () => {
		// For what `call()` does not cover, such as an upload through `files.create`.
		const { client, driver } = setup();

		expect(driver.client).toBe(client);
	});

	test('Posts the body through rawRequest and answers what Stripe answered', async () => {
		// Network retries are off so none outlives the deadline; without a raw response on the answer the status is 200
		// and there are no headers.
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({ id: 're_1', object: 'refund' });

		await expect(driver.call('POST /v1/refunds', { payment_intent: 'pi_1', amount: 500 })).resolves.toStrictEqual({
			status: 200,
			headers: {},
			data: { id: 're_1', object: 'refund' },
		});

		expect(raw).toHaveBeenCalledWith(
			'POST',
			'/v1/refunds',
			{ payment_intent: 'pi_1', amount: 500 },
			{ timeout: 30_000, maxNetworkRetries: 0 },
		);
	});

	test("Puts a GET's parameters in the path in Stripe's bracket notation, and passes timeout and headers", async () => {
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({ data: [] });

		await driver.call(
			'get /v1/invoices',
			{ customer: 'cus_1', expand: ['data.customer'], created: { gte: 10 }, limit: undefined },
			{ timeout: 5_000, headers: { 'Stripe-Account': 'acct_1' } },
		);

		expect(raw).toHaveBeenCalledWith(
			'GET',
			'/v1/invoices?customer=cus_1&expand[0]=data.customer&created[gte]=10',
			undefined,
			{ timeout: 5_000, maxNetworkRetries: 0, additionalHeaders: { 'Stripe-Account': 'acct_1' } },
		);
	});

	test("Sends a full URL on Stripe's files host to the SDK's files base", async () => {
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({ data: [] });

		await driver.call('GET https://files.stripe.com/v1/files?limit=3');

		expect(raw).toHaveBeenCalledWith('GET', '/v1/files?limit=3', undefined, {
			timeout: 30_000,
			maxNetworkRetries: 0,
			apiBase: 'files',
		});
	});

	test('Refuses a URL on another host, or plain http, before any request', async () => {
		// The key would travel with the request, so nothing is sent at all.
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');

		await expect(driver.call('GET https://evil.example/v1/customers')).rejects.toThrow('evil.example');
		await expect(driver.call('GET http://api.stripe.com/v1/customers')).rejects.toThrow('not on a Stripe host');
		await expect(driver.call('customers')).rejects.toThrow('is not');
		expect(raw).not.toHaveBeenCalled();
	});

	test('Refuses parameters a PATCH cannot carry, and a file, before any request', async () => {
		// Stripe takes a body on POST only, and the raw request sends no multipart body.
		const { client, driver } = setup();
		const fetch = vi.fn();
		const raw = vi.spyOn(client, 'rawRequest');

		vi.stubGlobal('fetch', fetch);

		await expect(driver.call('PATCH /v1/customers/cus_1', { name: 'Ada' })).rejects.toThrow('POST only');
		await expect(driver.call('POST /v1/files', { file: new Blob(['x']) })).rejects.toThrow('files.create');
		await expect(driver.call('POST /v1/files', { files: [new Blob(['x'])] })).rejects.toThrow('files.create');

		expect(fetch).not.toHaveBeenCalled();
		expect(raw).not.toHaveBeenCalled();
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');

		await expect(
			driver.call('GET /v1/customers', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(raw).not.toHaveBeenCalled();
	});

	test('Turns a refusal into ProviderCallError with the status and Stripe error, and never names the key', async () => {
		const client = new Stripe('sk_test_SECRET_KEY_123');
		const driver = new PaymentsDriverStripe({ secretKey: 'sk_test_SECRET_KEY_123', webhookSecret: 'whsec', client });

		vi.spyOn(client, 'rawRequest').mockRejectedValue(refusal(404));

		const error = (await driver
			.call('GET /v1/payment_intents/pi_404')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);

		expect(error.extensions).toMatchObject({
			provider: 'stripe',
			method: 'GET /v1/payment_intents/pi_404',
			status: 404,
			body: { error: { type: 'invalid_request_error', code: 'resource_missing' } },
		});

		expect(error.extensions.body).not.toHaveProperty('error.headers');
		expect(error.message).toContain('No such payment_intent');
		expect(error.cause).toBeInstanceOf(Stripe.errors.StripeError);
		expect(error.message).not.toContain('SECRET_KEY');
		expect(JSON.stringify(error.extensions)).not.toContain('SECRET_KEY');
	});

	test('Turns a 429 into HitRateLimitError reset at Retry-After', async () => {
		const { client, driver } = setup();

		vi.spyOn(client, 'rawRequest').mockRejectedValue(refusal(429, { 'retry-after': '2' }));

		const error = (await driver.call('GET /v1/customers').catch((caught: unknown) => caught)) as InstanceType<
			typeof HitRateLimitError
		>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.extensions.reset.getTime()).toBeGreaterThan(Date.now() + 1_000);
	});

	test('Gives up with TimeoutError at the timeout', async () => {
		const { client, driver } = setup();

		vi.spyOn(client, 'rawRequest').mockReturnValue(new Promise(() => {}));

		await expect(driver.call('GET /v1/customers', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test("Answers with the status and headers of the SDK's raw response", async () => {
		// The SDK hangs the raw response on the answer as a non-enumerable key; Node's client gives a record of
		// headers.
		const { client, driver } = setup();
		const answer = { id: 'cus_1', object: 'customer' };

		Object.defineProperty(answer, 'lastResponse', {
			enumerable: false,
			value: { statusCode: 200, headers: { 'Request-Id': 'req_1', 'stripe-version': '2025-01-01' } },
		});

		vi.spyOn(client, 'rawRequest').mockResolvedValue(answer as never);

		const result = await driver.call('GET /v1/customers/cus_1');

		expect(result).toStrictEqual({
			status: 200,
			headers: { 'request-id': 'req_1', 'stripe-version': '2025-01-01' },
			data: answer,
		});

		expect(result.data).toBe(answer);
	});

	test("Reads the fetch client's raw response", async () => {
		const { client, driver } = setup();
		const answer = { id: 'cus_1' };

		Object.defineProperty(answer, 'lastResponse', {
			enumerable: false,
			value: new Response(null, { status: 201, headers: { 'Request-Id': 'req_2' } }),
		});

		vi.spyOn(client, 'rawRequest').mockResolvedValue(answer as never);

		await expect(driver.call('POST /v1/customers')).resolves.toStrictEqual({
			status: 201,
			headers: { 'request-id': 'req_2' },
			data: answer,
		});
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({});

		await driver.call('GET /v1/customers/{id}', { id: 'cus/1 x', expand: ['subscriptions'] });

		expect(raw).toHaveBeenCalledWith('GET', '/v1/customers/cus%2F1%20x?expand[0]=subscriptions', undefined, {
			timeout: 30_000,
			maxNetworkRetries: 0,
		});

		await driver.call('POST /v1/customers/{id}', { id: 'cus_1', name: 'Ada' });

		expect(raw).toHaveBeenLastCalledWith(
			'POST',
			'/v1/customers/cus_1',
			{ name: 'Ada' },
			{
				timeout: 30_000,
				maxNetworkRetries: 0,
			},
		);
	});

	test('Refuses a {name} no parameter fills before any request', async () => {
		// Sent, it would reach Stripe as `%7Bid%7D`.
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');
		const fetch = vi.fn();

		vi.stubGlobal('fetch', fetch);

		await expect(driver.call('GET /v1/customers/{id}', { name: 'Ada' })).rejects.toThrow('{id}');
		await expect(driver.call('POST /v1/files/{id}', { file: new Blob(['x']) })).rejects.toThrow('{id}');
		expect(raw).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
