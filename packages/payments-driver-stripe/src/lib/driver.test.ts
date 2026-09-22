/**
 * Tests of the Stripe driver: the resources stubbed on a real client, the webhooks signed the way Stripe signs them
 * and read from fixtures shaped like Stripe's current events. The mappings have their own tests beside their modules
 * (`to-event.test.ts`, `to-invoice.test.ts`, `to-subscription.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import Stripe from 'stripe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PaymentsDriverStripe, PRORATION } from './driver.js';
import { toInvoice } from './to-invoice.js';

/**
 * A fixture event, parsed.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The event object.
 */
const fixture = (name: string): Stripe.Event =>
	JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Stripe.Event;

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

		vi.spyOn(client.subscriptions, 'retrieve').mockResolvedValue(stripeSubscription as never);
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
