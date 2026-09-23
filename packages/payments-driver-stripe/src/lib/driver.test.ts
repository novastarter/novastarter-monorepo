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
	// 1. A real client, so `webhooks` verifies signatures for real; the resources are spied on per test, so nothing
	//    ever reaches the network
	const client = new Stripe('sk_test_x', { appInfo: { name: 'test' } });

	// 2. The driver takes the client instead of building one, which is what the `client` option exists for
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
	// 1. The signature covers the exact bytes, so the text is made once and used for both the header and the call
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });

	// 2. Headers arrive lower-cased, as the route hands them to the driver
	return driver.parseWebhook(payload, { 'stripe-signature': header, 'content-type': 'application/json' });
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('PaymentsDriverStripe', () => {
	test('Refuses to start without a secret key or a webhook secret', () => {
		// 1. Each missing value is named in the error, so a misconfigured deployment says which option to set
		expect(() => new PaymentsDriverStripe({ secretKey: '', webhookSecret: 'whsec' })).toThrow('"secretKey"');
		expect(() => new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test("Passes the application's appInfo to the client and nothing without one", () => {
		// 1. The client records what it was built with; the driver neither invents a name nor drops the given one
		const named = new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: 'whsec', appInfo: { name: 'Acme' } });
		const anonymous = new PaymentsDriverStripe({ secretKey: 'sk', webhookSecret: 'whsec' });

		expect(named['client']._appInfo).toMatchObject({ name: 'Acme' });
		expect(anonymous['client']._appInfo).toBeUndefined();
	});

	test('Creates a customer with the organization in its metadata', async () => {
		// 1. Stripe answers the customer as created; the stub returns what the request carried
		const { client, driver } = setup();

		const create = vi.spyOn(client.customers, 'create').mockResolvedValue({
			id: 'cus_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		} as never);

		// 2. The normalised customer carries Stripe's id and the metadata the sync keys on
		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({
			id: 'cus_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});

		// 3. Every given field is sent as is, under Stripe's names
		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});
	});

	test('Starts a subscription checkout with the metadata on the session and on the subscription', async () => {
		// 1. Stripe answers a hosted session with its page and expiry
		const { client, driver } = setup();

		const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue({
			id: 'cs_1',
			url: 'https://checkout.stripe.com/c/pay/cs_1',
			expires_at: 1789171100,
		} as never);

		// 2. The session's expiry is a Stripe timestamp, answered as a `Date`
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

		// 3. Subscription mode, one line item, the metadata on the session and under `subscription_data`, so the
		//    subscription's own events carry it too
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

		// 4. A session without a URL cannot be redirected to
		create.mockResolvedValue({ id: 'cs_2', url: null, expires_at: 1 } as never);

		await expect(
			driver.createCheckoutSession({ customerId: 'c', priceId: 'p', successUrl: 's', cancelUrl: 'c' }),
		).rejects.toThrow('no URL');
	});

	test('Opens the portal', async () => {
		// 1. Stripe answers the portal session with its page
		const { client, driver } = setup();

		const create = vi
			.spyOn(client.billingPortal.sessions, 'create')
			.mockResolvedValue({ url: 'https://billing.stripe.com/session/x' } as never);

		// 2. The URL is all the caller needs; the customer and the way back are what Stripe needs
		await expect(
			driver.createPortalSession({ customerId: 'cus_1', returnUrl: 'https://app/billing' }),
		).resolves.toStrictEqual({
			url: 'https://billing.stripe.com/session/x',
		});

		expect(create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app/billing' });
	});

	test('Reads, updates and cancels a subscription through its item', async () => {
		// 1. One Stripe subscription, as the fixture carries it, answers every stubbed call
		const { client, driver } = setup();
		const stripeSubscription = fixture('customer.subscription.created').data.object as Stripe.Subscription;

		const retrieve = vi.spyOn(client.subscriptions, 'retrieve').mockResolvedValue(stripeSubscription as never);
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(stripeSubscription as never);
		const cancel = vi.spyOn(client.subscriptions, 'cancel').mockResolvedValue(stripeSubscription as never);

		// 2. A read is the retrieval, normalised
		await expect(driver.getSubscription('sub_1S5abcDEF123456789')).resolves.toMatchObject({
			id: 'sub_1S5abcDEF123456789',
			status: 'trialing',
			quantity: 3,
		});

		// 3. A plan change and a seat change go on the item, with the proration as asked
		await driver.updateSubscription({
			subscriptionId: 'sub_1S5abcDEF123456789',
			priceId: 'price_business_monthly',
			quantity: 10,
			proration: 'invoice',
		});

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			items: [{ id: 'si_T1abcDEF12345', price: 'price_business_monthly', quantity: 10 }],
			proration_behavior: 'always_invoice',
		});

		// 4. Without a proration choice the kit prorates, and only the given change goes on the item
		await driver.updateSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', quantity: 4 });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			items: [{ id: 'si_T1abcDEF12345', quantity: 4 }],
			proration_behavior: PRORATION.prorate,
		});

		// 5. Cancelling at period end is an update; right away is a cancel — both pass the reason on
		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', reason: 'Too expensive' });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			cancel_at_period_end: true,
			cancellation_details: { comment: 'Too expensive' },
		});

		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', immediately: true });

		expect(cancel).toHaveBeenCalledWith('sub_1S5abcDEF123456789', {});

		// 6. Neither a price nor a quantity is a caller's mistake, refused before any request is sent
		await expect(driver.updateSubscription({ subscriptionId: 'sub_1S5abcDEF123456789' })).rejects.toThrow(
			'Nothing to update',
		);

		expect(retrieve).toHaveBeenCalledTimes(3);
	});

	test('Lists invoices', async () => {
		// 1. Stripe answers a page of invoices; one from the fixture is enough to check the mapping is applied
		const { client, driver } = setup();
		const invoice = fixture('invoice.paid').data.object as Stripe.Invoice;

		const list = vi.spyOn(client.invoices, 'list').mockResolvedValue({ data: [invoice] } as never);

		// 2. Each invoice is normalised; the customer and the limit are passed through as given
		await expect(driver.listInvoices({ customerId: 'cus_T1abcDEF12345', limit: 10 })).resolves.toStrictEqual([
			toInvoice(invoice),
		]);

		expect(list).toHaveBeenCalledWith({ customer: 'cus_T1abcDEF12345', limit: 10 });

		// 3. Without a limit the kit's default of twenty is sent: leaving it out would let Stripe page at ten
		await expect(driver.listInvoices({ customerId: 'cus_T1abcDEF12345' })).resolves.toStrictEqual([toInvoice(invoice)]);

		expect(list).toHaveBeenCalledWith({ customer: 'cus_T1abcDEF12345', limit: 20 });
	});

	test('Verifies a signed webhook and refuses a wrong signature, a missing header and a broken body', async () => {
		// 1. A delivery signed with the endpoint's secret is verified and mapped
		const { driver } = setup();
		const event = fixture('customer.subscription.created');

		await expect(deliver(driver, event)).resolves.toMatchObject({
			id: 'evt_1S5subCreated00001',
			type: 'subscription.created',
			provider: 'stripe',
		});

		// 2. Another secret is a forged delivery; no header at all is a malformed one
		await expect(deliver(driver, event, 'whsec_other')).rejects.toBeInstanceOf(InvalidCredentialsError);

		await expect(driver.parseWebhook(JSON.stringify(event), {})).rejects.toBeInstanceOf(InvalidPayloadError);

		// 3. A body altered after signing is a wrong signature; an unreadable body with a good signature is a payload
		const payload = JSON.stringify(event);
		const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

		await expect(driver.parseWebhook(`${payload} `, { 'stripe-signature': header })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		await expect(deliver(driver, '{not json')).rejects.toBeInstanceOf(InvalidPayloadError);
	});

	test('Refuses a signed body that is JSON but not a Stripe event', async () => {
		// 1. The SDK only verifies and parses; without a shape check a signed `{"hello":1}` would be dropped as an
		//    event of no interest and acknowledged with 200, so the driver refuses it as a payload problem instead
		const { driver } = setup();

		await expect(deliver(driver, '{"hello":1}')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '{"hello":1}')).rejects.toThrow('not a Stripe event');

		// 2. JSON that is not an object at all, and an event without its `data.object`, are refused the same way
		await expect(deliver(driver, 'null')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '"evt_1"')).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(deliver(driver, '{"id":"evt_1","type":"invoice.paid"}')).rejects.toBeInstanceOf(InvalidPayloadError);

		// 3. An event of a type the kit does not act on is still an event: verified and dropped, not refused
		await expect(deliver(driver, fixture('customer.subscription.trial_will_end'))).resolves.toBeNull();
	});

	test('Verifies the key with the cheapest read', async () => {
		// 1. One customer is the smallest authenticated read there is
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

	test('Posts the body through rawRequest and answers what Stripe answered', async () => {
		// 1. A POST carries its parameters as the body; the path and verb go to the SDK as given
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({ id: 're_1', object: 'refund' });

		await expect(driver.call('POST /v1/refunds', { payment_intent: 'pi_1', amount: 500 })).resolves.toStrictEqual({
			id: 're_1',
			object: 'refund',
		});

		expect(raw).toHaveBeenCalledWith(
			'POST',
			'/v1/refunds',
			{ payment_intent: 'pi_1', amount: 500 },
			{ timeout: 30_000 },
		);
	});

	test("Puts a GET's parameters in the path in Stripe's bracket notation, and passes timeout and headers", async () => {
		// 1. A list by index and an object by key, as Stripe reads them; no body on a GET
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
			{ timeout: 5_000, additionalHeaders: { 'Stripe-Account': 'acct_1' } },
		);
	});

	test("Sends a full URL on Stripe's files host to the SDK's files base", async () => {
		// 1. The host picks the base; the request still goes through the client and its key
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({ data: [] });

		await driver.call('GET https://files.stripe.com/v1/files?limit=3');

		expect(raw).toHaveBeenCalledWith('GET', '/v1/files?limit=3', undefined, { timeout: 30_000, apiBase: 'files' });
	});

	test('Refuses a URL on another host, or plain http, before any request', async () => {
		// 1. The key would travel with the request, so nothing is sent at all
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');

		await expect(driver.call('GET https://evil.example/v1/customers')).rejects.toThrow('evil.example');
		await expect(driver.call('GET http://api.stripe.com/v1/customers')).rejects.toThrow('not on a host');
		await expect(driver.call('customers')).rejects.toThrow('is not');
		expect(raw).not.toHaveBeenCalled();
	});

	test('Refuses parameters a PATCH cannot carry, and a file in a query', async () => {
		// 1. Stripe takes a body on POST only, and a file has no place in a query; nothing is sent either way
		const { client, driver } = setup();
		const fetch = vi.fn();
		const raw = vi.spyOn(client, 'rawRequest');

		vi.stubGlobal('fetch', fetch);

		await expect(driver.call('PATCH /v1/customers/cus_1', { name: 'Ada' })).rejects.toThrow('POST only');
		await expect(driver.call('GET /v1/files', { file: new Blob(['x']) })).rejects.toThrow('POST body only');

		await expect(driver.call('POST /v1/files', { file: new Blob(['x']) }, { paramsIn: 'query' })).rejects.toThrow(
			'POST body only',
		);

		expect(fetch).not.toHaveBeenCalled();
		expect(raw).not.toHaveBeenCalled();
	});

	test("Uploads a file as multipart to Stripe's files host with the key and the client's API version", async () => {
		// 1. The upload bypasses the SDK's raw request, which has no multipart; `fetch` answers Stripe's file object
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');

		const fetch = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(JSON.stringify({ id: 'file_1', object: 'file' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);

		vi.stubGlobal('fetch', fetch);

		const file = new File(['%PDF-1'], 'receipt.pdf', { type: 'application/pdf' });

		const result = await driver.call(
			'POST https://files.stripe.com/v1/files',
			{ purpose: 'dispute_evidence', file, skip: undefined },
			{ headers: { 'Stripe-Account': 'acct_1' } },
		);

		expect(result).toStrictEqual({ id: 'file_1', object: 'file' });
		expect(raw).not.toHaveBeenCalled();

		// 2. The URL as given, Bearer auth, the pinned version, the caller's header, and a multipart body with the file
		const [url, init] = fetch.mock.calls[0]!;
		const headers = init.headers as Record<string, string>;

		expect(url).toBe('https://files.stripe.com/v1/files');
		expect(init.method).toBe('POST');
		expect(init.redirect).toBe('manual');
		expect(headers['authorization']).toBe('Bearer sk_test_x');
		expect(headers['stripe-version']).toBe(Stripe.API_VERSION);
		expect(headers['stripe-account']).toBe('acct_1');
		expect(headers).not.toHaveProperty('content-type');

		const body = init.body as FormData;

		expect(body).toBeInstanceOf(FormData);
		expect(body.get('purpose')).toBe('dispute_evidence');
		expect(body.has('skip')).toBe(false);
		expect((body.get('file') as File).name).toBe('receipt.pdf');
		await expect((body.get('file') as File).text()).resolves.toBe('%PDF-1');
	});

	test('Uploads a file given in a list to the client host for a path', async () => {
		// 1. A path goes to the client's own host; a list of files repeats its field
		const { driver } = setup();
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));

		vi.stubGlobal('fetch', fetch);

		const files = [new Blob(['a']), new Blob(['b'])];

		await expect(driver.call('POST /v1/files', { files })).resolves.toBeUndefined();

		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe('https://api.stripe.com/v1/files');
		expect((init.body as FormData).getAll('files')).toHaveLength(2);
	});

	test('Refuses an upload to a foreign host before any request', async () => {
		// 1. The key would travel with the file, so nothing is sent at all
		const { driver } = setup();
		const fetch = vi.fn();

		vi.stubGlobal('fetch', fetch);

		await expect(driver.call('POST https://evil.example/v1/files', { file: new Blob(['x']) })).rejects.toThrow(
			'not on a host',
		);

		expect(fetch).not.toHaveBeenCalled();
	});

	test('Turns a refused upload into ProviderCallError and a 429 into HitRateLimitError, no key in them', async () => {
		// 1. A driver with a recognisable key, whose upload Stripe refuses
		const secretKey = 'sk_test_SECRET_KEY_123';
		const driver = new PaymentsDriverStripe({ secretKey, webhookSecret: 'whsec', client: new Stripe(secretKey) });
		const refused = { error: { type: 'invalid_request_error', message: 'Invalid purpose' } };

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(refused), { status: 400 })),
		);

		const error = (await driver
			.call('POST https://files.stripe.com/v1/files', { purpose: 'x', file: new Blob(['x']) })
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		// 2. Stripe's status and `{ error }`; neither the message, the error nor its cause names the key
		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.extensions).toMatchObject({ provider: 'stripe', status: 400, body: refused });
		expect(error.message).not.toContain('SECRET_KEY');
		expect(JSON.stringify(error)).not.toContain('SECRET_KEY');
		expect(JSON.stringify(error.cause ?? null)).not.toContain('SECRET_KEY');

		// 3. Too many requests is a rate limit the caller may wait out
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } })),
		);

		await expect(
			driver.call('POST https://files.stripe.com/v1/files', { file: new Blob(['x']) }),
		).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Gives up an upload with TimeoutError at the timeout', async () => {
		// 1. A `fetch` that never answers is cut at the call's timeout
		const { driver } = setup();

		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);

		await expect(
			driver.call('POST https://files.stripe.com/v1/files', { file: new Blob(['x']) }, { timeout: 10 }),
		).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Puts the parameters of a POST in the query when asked, and refuses a body on another verb', async () => {
		// 1. `paramsIn: 'query'` moves a POST's parameters into the path, with no body
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest').mockResolvedValue({});

		await driver.call('POST /v1/invoices/in_1/pay', { expand: ['customer'] }, { paramsIn: 'query' });

		expect(raw).toHaveBeenCalledWith('POST', '/v1/invoices/in_1/pay?expand[0]=customer', undefined, {
			timeout: 30_000,
		});

		// 2. The raw request sends a body on POST only, so a body asked of a DELETE is refused before anything is sent
		raw.mockClear();

		const deletion = driver.call('DELETE /v1/customers/cus_1/discount', { a: 1 }, { paramsIn: 'body' });

		await expect(deletion).rejects.toThrow('POST only');

		expect(raw).not.toHaveBeenCalled();
	});

	test('Sends nothing when the signal is already aborted', async () => {
		// 1. An aborted signal fails the call with its reason before the SDK is reached
		const { client, driver } = setup();
		const raw = vi.spyOn(client, 'rawRequest');

		await expect(
			driver.call('GET /v1/customers', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(raw).not.toHaveBeenCalled();
	});

	test('Turns a refusal into ProviderCallError with the status and Stripe error, and never names the key', async () => {
		// 1. A driver with a recognisable key, whose request Stripe refuses with 404
		const client = new Stripe('sk_test_SECRET_KEY_123');
		const driver = new PaymentsDriverStripe({ secretKey: 'sk_test_SECRET_KEY_123', webhookSecret: 'whsec', client });

		vi.spyOn(client, 'rawRequest').mockRejectedValue(refusal(404));

		const error = (await driver
			.call('GET /v1/payment_intents/pi_404')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		// 2. Stripe's status and its `error` object, the SDK's additions left out, the SDK's exception as the cause
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
		// 1. Stripe names the wait in the header
		const { client, driver } = setup();

		vi.spyOn(client, 'rawRequest').mockRejectedValue(refusal(429, { 'retry-after': '2' }));

		const error = (await driver.call('GET /v1/customers').catch((caught: unknown) => caught)) as InstanceType<
			typeof HitRateLimitError
		>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.extensions.reset.getTime()).toBeGreaterThan(Date.now() + 1_000);
	});

	test('Gives up with TimeoutError at the timeout', async () => {
		// 1. A request that never settles
		const { client, driver } = setup();

		vi.spyOn(client, 'rawRequest').mockReturnValue(new Promise(() => {}));

		await expect(driver.call('GET /v1/customers', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});
});
