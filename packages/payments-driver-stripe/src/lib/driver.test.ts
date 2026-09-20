/**
 * Tests of the Stripe driver: the resources stubbed on a real client, the webhooks signed the way Stripe signs them
 * and read from fixtures shaped like Stripe's current events.
 */
import { readFileSync } from 'node:fs';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import Stripe from 'stripe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DriverStripe, PRORATION } from './driver.js';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toSubscription } from './to-subscription.js';

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
	const client = new Stripe('sk_test_x', { appInfo: { name: 'test' } });
	const driver = new DriverStripe({ secretKey: 'sk_test_x', webhookSecret: WEBHOOK_SECRET, client });

	return { client, driver };
};

/**
 * Deliver a fixture through `parseWebhook`, signed with the given secret.
 *
 * @param driver - The driver under test.
 * @param event - The event object.
 * @param secret - The signing secret; the right one unless given.
 * @returns What `parseWebhook` answered.
 */
const deliver = (driver: DriverStripe, event: Stripe.Event, secret = WEBHOOK_SECRET) => {
	const payload = JSON.stringify(event);
	const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });

	return driver.parseWebhook(payload, { 'stripe-signature': header, 'content-type': 'application/json' });
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('DriverStripe', () => {
	test('Refuses to start without a secret key or a webhook secret', () => {
		expect(() => new DriverStripe({ secretKey: '', webhookSecret: 'whsec' })).toThrow('"secretKey"');
		expect(() => new DriverStripe({ secretKey: 'sk', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test("Passes the application's appInfo to the client and nothing without one", () => {
		// 1. The client records what it was built with; the driver neither invents a name nor drops the given one
		const named = new DriverStripe({ secretKey: 'sk', webhookSecret: 'whsec', appInfo: { name: 'Acme' } });
		const anonymous = new DriverStripe({ secretKey: 'sk', webhookSecret: 'whsec' });

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

		// 1. A session without a URL cannot be redirected to
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

		vi.spyOn(client.subscriptions, 'retrieve').mockResolvedValue(stripeSubscription as never);
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(stripeSubscription as never);
		const cancel = vi.spyOn(client.subscriptions, 'cancel').mockResolvedValue(stripeSubscription as never);

		await expect(driver.getSubscription('sub_1S5abcDEF123456789')).resolves.toMatchObject({
			id: 'sub_1S5abcDEF123456789',
			status: 'trialing',
			quantity: 3,
		});

		// 1. A plan change and a seat change go on the item, with the proration as asked
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

		await driver.updateSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', quantity: 4 });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			items: [{ id: 'si_T1abcDEF12345', quantity: 4 }],
			proration_behavior: PRORATION.prorate,
		});

		// 2. Cancelling at period end is an update; right away is a cancel — both pass the reason on
		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', reason: 'Too expensive' });

		expect(update).toHaveBeenLastCalledWith('sub_1S5abcDEF123456789', {
			cancel_at_period_end: true,
			cancellation_details: { comment: 'Too expensive' },
		});

		await driver.cancelSubscription({ subscriptionId: 'sub_1S5abcDEF123456789', immediately: true });

		expect(cancel).toHaveBeenCalledWith('sub_1S5abcDEF123456789', {});
	});

	test('Lists invoices', async () => {
		const { client, driver } = setup();
		const invoice = fixture('invoice.paid').data.object as Stripe.Invoice;

		const list = vi.spyOn(client.invoices, 'list').mockResolvedValue({ data: [invoice] } as never);

		await expect(driver.listInvoices({ customerId: 'cus_T1abcDEF12345', limit: 10 })).resolves.toStrictEqual([
			toInvoice(invoice),
		]);

		expect(list).toHaveBeenCalledWith({ customer: 'cus_T1abcDEF12345', limit: 10 });
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

		// 1. A body altered after signing is a wrong signature; an unreadable body with a good signature is a payload
		const payload = JSON.stringify(event);
		const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

		await expect(driver.parseWebhook(`${payload} `, { 'stripe-signature': header })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		const brokenHeader = Stripe.webhooks.generateTestHeaderString({ payload: '{not json', secret: WEBHOOK_SECRET });

		await expect(driver.parseWebhook('{not json', { 'stripe-signature': brokenHeader })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);
	});

	test('Verifies the key with the cheapest read', async () => {
		const { client, driver } = setup();
		const list = vi.spyOn(client.customers, 'list').mockResolvedValue({ data: [] } as never);

		await driver.verify();

		expect(list).toHaveBeenCalledWith({ limit: 1 });
	});
});

describe('toSubscription', () => {
	test('Reads the item for price, seats and the period, the subscription for the rest', () => {
		const subscription = toSubscription(fixture('customer.subscription.updated').data.object as Stripe.Subscription);

		expect(subscription).toStrictEqual({
			id: 'sub_1S5abcDEF123456789',
			customerId: 'cus_T1abcDEF12345',
			status: 'active',
			priceId: 'price_pro_monthly',
			productId: 'prod_T1pro',
			quantity: 5,
			interval: 'month',
			currentPeriodStart: new Date(1789084800 * 1000),
			currentPeriodEnd: new Date(1791676800 * 1000),
			cancelAtPeriodEnd: true,
			cancelAt: new Date(1791676800 * 1000),
			canceledAt: new Date(1790000000 * 1000),
			trialEnd: new Date(1790294400 * 1000),
			endedAt: null,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});

	test('Refuses a subscription without items or with a status it does not know', () => {
		const subscription = fixture('customer.subscription.created').data.object as Stripe.Subscription;

		expect(() => toSubscription({ ...subscription, items: { ...subscription.items, data: [] } })).toThrow(
			'has no items',
		);

		expect(() => toSubscription({ ...subscription, status: 'frozen' as never })).toThrow('unknown status "frozen"');
	});
});

describe('toInvoice', () => {
	test('Maps amounts, the subscription of the parent and the links', () => {
		expect(toInvoice(fixture('invoice.paid').data.object as Stripe.Invoice)).toStrictEqual({
			id: 'in_1S5abcDEF12345',
			number: 'A1B2C3D4-0001',
			customerId: 'cus_T1abcDEF12345',
			subscriptionId: 'sub_1S5abcDEF123456789',
			status: 'paid',
			total: { amount: 5700, currency: 'usd' },
			amountPaid: 5700,
			amountDue: 5700,
			createdAt: new Date(1791676800 * 1000),
			dueAt: null,
			paidAt: new Date(1791676805 * 1000),
			hostedUrl: 'https://invoice.stripe.com/i/acct_1/test_YWNjdF8x',
			pdfUrl: 'https://pay.stripe.com/invoice/acct_1/test_YWNjdF8x/pdf',
		});
	});
});

describe('toEvent', () => {
	test('Maps the events the kit acts on and drops the rest', () => {
		expect(toEvent(fixture('checkout.session.completed'))).toMatchObject({
			id: 'evt_1S5checkout000006',
			type: 'checkout.completed',
			provider: 'stripe',
			occurredAt: new Date(1789084800 * 1000),
			checkout: {
				id: 'cs_test_a1B2c3D4e5F6g7H8i9J0',
				customerId: 'cus_T1abcDEF12345',
				subscriptionId: 'sub_1S5abcDEF123456789',
				metadata: { organizationId: 'org_42', planId: 'pro' },
			},
		});

		expect(toEvent(fixture('customer.subscription.created'))).toMatchObject({
			type: 'subscription.created',
			subscription: { status: 'trialing', quantity: 3 },
		});

		expect(toEvent(fixture('customer.subscription.updated'))).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'active', cancelAtPeriodEnd: true },
		});

		expect(toEvent(fixture('customer.subscription.deleted'))).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled', endedAt: new Date(1791676800 * 1000) },
		});

		expect(toEvent(fixture('invoice.paid'))).toMatchObject({ type: 'invoice.paid', invoice: { status: 'paid' } });

		expect(toEvent(fixture('invoice.payment_failed'))).toMatchObject({
			type: 'invoice.failed',
			invoice: { id: 'in_1S5abcDEF12346', status: 'open', amountPaid: 0, paidAt: null },
		});

		expect(toEvent(fixture('customer.subscription.trial_will_end'))).toBeNull();

		// 1. The raw event rides along for the audit trail
		expect(toEvent(fixture('invoice.paid'))?.raw).toStrictEqual(fixture('invoice.paid'));
	});

	test('Ignores a one-off payment checkout', () => {
		const event = fixture('checkout.session.completed');
		const session = event.data.object as Stripe.Checkout.Session;

		expect(toEvent({ ...event, data: { object: { ...session, mode: 'payment' } } } as Stripe.Event)).toBeNull();
	});
});
