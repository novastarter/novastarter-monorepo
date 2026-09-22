/**
 * Tests of the Polar driver: the resources stubbed on a real client, the webhooks signed the way Polar signs them
 * (Standard Webhooks) and read from fixtures that pass the SDK's own schemas. The mappings the driver hands its
 * answers through have their own test files next to them.
 */
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { Polar } from '@polar-sh/sdk';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixtureText, parsed, sign, WEBHOOK_SECRET } from '../fixtures/index.js';
import { PaymentsDriverPolar } from './driver.js';
import { toInvoice } from './to-invoice.js';

/**
 * A driver on a real client whose resources are stubbed — no network, real webhook verification.
 *
 * @returns The driver and the client to stub on.
 */
const setup = () => {
	// 1. A real client so the stubs go on the SDK's own resources; the driver takes it instead of building one
	const client = new Polar({ accessToken: 'polar_oat_x', server: 'sandbox' });
	const driver = new PaymentsDriverPolar({ accessToken: 'polar_oat_x', webhookSecret: WEBHOOK_SECRET, client });

	return { client, driver };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('PaymentsDriverPolar', () => {
	test('Refuses to start without a token or a webhook secret', () => {
		// 1. Each missing value is named, so a misconfigured deployment fails at registration with the key to set
		expect(() => new PaymentsDriverPolar({ accessToken: '', webhookSecret: 's' })).toThrow('"accessToken"');
		expect(() => new PaymentsDriverPolar({ accessToken: 't', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test('Creates a customer with the organization in its metadata, values as strings', async () => {
		const { client, driver } = setup();

		// 1. Polar answers metadata with a number in it, which the kit's flat string shape has to absorb
		const create = vi.spyOn(client.customers, 'create').mockResolvedValue({
			id: 'cust_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42', seats: 3 },
		} as never);

		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({
			id: 'cust_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42', seats: '3' },
		});

		// 2. Only the fields given go to Polar, so its defaults apply to the rest
		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});
	});

	test('Starts a checkout for the product, with seats, a trial in days and the metadata', async () => {
		const { client, driver } = setup();
		const expiresAt = new Date('2026-09-10T12:55:00Z');

		// 1. The hosted page and its expiry are all the driver reads off the checkout
		const create = vi
			.spyOn(client.checkouts, 'create')
			.mockResolvedValue({ id: 'chk_1', url: 'https://polar.sh/checkout/x', expiresAt } as never);

		await expect(
			driver.createCheckoutSession({
				customerId: 'cust_1',
				priceId: 'prod_pro',
				quantity: 3,
				successUrl: 'https://app/billing?ok',
				cancelUrl: 'https://app/billing/plans',
				trialDays: 14,
				allowPromotionCodes: true,
				metadata: { organizationId: 'org_42', planId: 'pro' },
			}),
		).resolves.toStrictEqual({ id: 'chk_1', url: 'https://polar.sh/checkout/x', expiresAt });

		// 2. The kit's names become Polar's: the price is a product, seats, the trial in days, the cancel URL as
		//    Polar's return URL
		expect(create).toHaveBeenCalledWith({
			products: ['prod_pro'],
			customerId: 'cust_1',
			successUrl: 'https://app/billing?ok',
			returnUrl: 'https://app/billing/plans',
			seats: 3,
			allowDiscountCodes: true,
			trialInterval: 'day',
			trialIntervalCount: 14,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});

	test('Opens the portal through a customer session', async () => {
		const { client, driver } = setup();

		// 1. Polar has no portal resource of its own: a customer session carries the portal URL
		const create = vi
			.spyOn(client.customerSessions, 'create')
			.mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal?token=x' } as never);

		await expect(
			driver.createPortalSession({ customerId: 'cust_1', returnUrl: 'https://app/billing' }),
		).resolves.toStrictEqual({ url: 'https://polar.sh/portal?token=x' });

		expect(create).toHaveBeenCalledWith({ customerId: 'cust_1', returnUrl: 'https://app/billing' });
	});

	test('Reads, updates and cancels a subscription', async () => {
		const { client, driver } = setup();
		const event = parsed('subscription.created');
		const subscription = event.type === 'subscription.created' ? event.data : undefined;

		// 1. The fixture's subscription stands in for what Polar answers to every read and update
		vi.spyOn(client.subscriptions, 'get').mockResolvedValue(subscription as never);
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(subscription as never);

		await expect(driver.getSubscription(subscription!.id)).resolves.toMatchObject({ status: 'trialing', quantity: 3 });

		// 2. A plan change and a seat change are two Polar updates, each with the proration asked for
		await driver.updateSubscription({
			subscriptionId: 'sub_1',
			priceId: 'prod_business',
			quantity: 10,
			proration: 'invoice',
		});

		expect(update).toHaveBeenNthCalledWith(1, {
			id: 'sub_1',
			subscriptionUpdate: { productId: 'prod_business', prorationBehavior: 'invoice' },
		});

		expect(update).toHaveBeenNthCalledWith(2, {
			id: 'sub_1',
			subscriptionUpdate: { seats: 10, prorationBehavior: 'invoice' },
		});

		// 3. The kit's `none` is Polar's `next_period`; nothing to change is a caller's mistake, not a silent no-op
		await driver.updateSubscription({ subscriptionId: 'sub_1', quantity: 4, proration: 'none' });

		expect(update).toHaveBeenLastCalledWith({
			id: 'sub_1',
			subscriptionUpdate: { seats: 4, prorationBehavior: 'next_period' },
		});

		await expect(driver.updateSubscription({ subscriptionId: 'sub_1' })).rejects.toThrow('Nothing to update');

		// 4. Cancelling at period end and revoking are both updates, with the reason as the customer's comment
		await driver.cancelSubscription({ subscriptionId: 'sub_1', reason: 'Too expensive' });

		expect(update).toHaveBeenLastCalledWith({
			id: 'sub_1',
			subscriptionUpdate: { cancelAtPeriodEnd: true, customerCancellationComment: 'Too expensive' },
		});

		await driver.cancelSubscription({ subscriptionId: 'sub_1', immediately: true });
		expect(update).toHaveBeenLastCalledWith({ id: 'sub_1', subscriptionUpdate: { revoke: true } });
	});

	test('Lists orders as invoices, most recent first', async () => {
		const { client, driver } = setup();
		const event = parsed('order.paid');
		const order = event.type === 'order.paid' ? event.data : undefined;

		// 1. One page of the SDK's paginated answer is all the driver reads
		const list = vi.spyOn(client.orders, 'list').mockResolvedValue({ result: { items: [order] } } as never);

		await expect(driver.listInvoices({ customerId: 'cust_1', limit: 10 })).resolves.toStrictEqual([toInvoice(order!)]);

		// 2. Newest first is asked of Polar, not sorted afterwards, so the limit cuts the right end
		expect(list).toHaveBeenCalledWith({ customerId: 'cust_1', sorting: ['-created_at'], limit: 10 });
	});

	test('Verifies a signed webhook and refuses a wrong signature, missing headers and a broken body', async () => {
		const { driver } = setup();
		const body = fixtureText('subscription.created');

		// 1. A body signed with the right secret comes back as the kit's event, under the delivery id
		await expect(driver.parseWebhook(body, sign(body))).resolves.toMatchObject({
			id: 'msg_2abc',
			type: 'subscription.created',
			provider: 'polar',
		});

		// 2. A wrong secret and a body altered after signing are both credentials problems, not payload ones
		await expect(driver.parseWebhook(body, sign(body, 'other'))).rejects.toBeInstanceOf(InvalidCredentialsError);
		await expect(driver.parseWebhook(`${body} `, sign(body))).rejects.toBeInstanceOf(InvalidCredentialsError);

		// 3. A missing header is a malformed delivery, named so the sender knows what to add
		const headers = sign(body);

		await expect(driver.parseWebhook(body, { 'webhook-id': headers['webhook-id'] })).rejects.toThrow(
			'no webhook-timestamp header',
		);

		// 4. A verified body that is not an event at all is a payload problem; one of a type this SDK does not know
		//    is dropped, since Polar adds event types over time
		await expect(driver.parseWebhook('{"hello":1}', sign('{"hello":1}'))).rejects.toBeInstanceOf(InvalidPayloadError);

		const unknown = JSON.stringify({ type: 'wallet.topped_up', timestamp: '2026-09-10T12:00:00Z', data: {} });

		await expect(driver.parseWebhook(unknown, sign(unknown))).resolves.toBeNull();
	});

	test('Refuses a known event type whose payload fails the schema instead of dropping it', async () => {
		const { driver } = setup();

		// 1. The type is one the SDK knows, the payload is not what its schema expects — what a change on Polar's side
		//    looks like; dropping it would lose every subscription delivery without a trace
		const drifted = JSON.stringify({
			type: 'subscription.created',
			timestamp: '2026-09-10T12:00:00Z',
			data: { id: 'sub_1' },
		});

		const failure = driver.parseWebhook(drifted, sign(drifted));

		await expect(failure).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(failure).rejects.toThrow('"subscription.created"');

		// 2. The SDK's error travels as the cause, with the schema's details for whoever inspects it
		await expect(failure).rejects.toMatchObject({ cause: expect.objectContaining({ name: 'SDKValidationError' }) });
	});

	test('Refuses a signed body that is not JSON as a payload problem', async () => {
		const { driver } = setup();

		// 1. The signature covers the bytes, so a non-JSON body verifies and only then fails to parse; that is the
		//    sender's mistake and answers 400, not a driver failure that answers 500 and has Polar retry forever
		const failure = driver.parseWebhook('{not json', sign('{not json'));

		await expect(failure).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(failure).rejects.toThrow('not JSON');
	});

	test('Verifies the token with the cheapest read', async () => {
		const { client, driver } = setup();

		// 1. One customer is the smallest authenticated read; the stub stands in for a token Polar accepts
		const list = vi.spyOn(client.customers, 'list').mockResolvedValue({ result: { items: [] } } as never);

		await driver.verify();

		expect(list).toHaveBeenCalledWith({ limit: 1 });
	});
});
