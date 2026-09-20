/**
 * Tests of the Paddle driver: the resources stubbed on a real client, the webhooks signed the way Paddle signs them
 * (`ts=…;h1=<hmac>`) and read from fixtures in the shape of Paddle's notification payloads.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { Environment, Paddle, Subscription, Transaction, Webhooks } from '@paddle/paddle-node-sdk';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DriverPaddle, PRORATION } from './driver.js';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'pdl_ntfset_test_secret';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Paddle event type it carries.
 * @returns The JSON text.
 */
const fixtureText = (name: string): string =>
	readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');

/**
 * A fixture's `data`, parsed the way the SDK parses a notification.
 *
 * @param name - The fixture.
 * @returns The event entity.
 */
const parsed = (name: string) => Webhooks.fromJson(JSON.parse(fixtureText(name)));

/**
 * The `paddle-signature` header for a body: `ts=<now>;h1=<hex hmac-sha256 of "ts:body">`, the way Paddle signs.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @param ts - The timestamp; now unless given.
 * @returns The header value.
 */
const sign = (body: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): string =>
	`ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

/**
 * A driver on a real client whose resources are stubbed — no network, real webhook verification.
 *
 * @returns The driver and the client to stub on.
 */
const setup = (checkoutUrl?: string) => {
	const client = new Paddle('pdl_sdbx_apikey_x', { environment: Environment.sandbox });

	const driver = new DriverPaddle({
		apiKey: 'pdl_sdbx_apikey_x',
		webhookSecret: WEBHOOK_SECRET,
		client,
		...(checkoutUrl !== undefined ? { checkoutUrl } : {}),
	});

	return { client, driver };
};

/**
 * The API's subscription entity from a fixture's data, the way `subscriptions.get()` would hand it back.
 *
 * @param name - The fixture.
 * @returns The entity.
 */
const apiSubscription = (name: string): Subscription => {
	const { data } = JSON.parse(fixtureText(name)) as { data: ConstructorParameters<typeof Subscription>[0] };

	return new Subscription({
		...data,
		management_urls: null,
		next_transaction: null,
		recurring_transaction_details: null,
	});
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('DriverPaddle', () => {
	test('Refuses to start without a key or a webhook secret', () => {
		expect(() => new DriverPaddle({ apiKey: '', webhookSecret: 's' })).toThrow('"apiKey"');
		expect(() => new DriverPaddle({ apiKey: 'k', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test('Creates a customer with the organization in its custom data', async () => {
		const { client, driver } = setup();

		const create = vi.spyOn(client.customers, 'create').mockResolvedValue({
			id: 'ctm_1',
			email: 'ada@example.com',
			name: 'Ada',
			customData: { organizationId: 'org_42', seats: 3 },
		} as never);

		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({
			id: 'ctm_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42', seats: '3' },
		});

		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			customData: { organizationId: 'org_42' },
		});
	});

	test('Starts a checkout as a transaction whose payment link opens on the checkout page', async () => {
		const { client, driver } = setup('https://app.example.com/checkout');

		const create = vi.spyOn(client.transactions, 'create').mockResolvedValue({
			id: 'txn_1',
			checkout: { url: 'https://app.example.com/checkout?_ptxn=txn_1' },
		} as never);

		await expect(
			driver.createCheckoutSession({
				customerId: 'ctm_1',
				priceId: 'pri_pro',
				quantity: 3,
				successUrl: 'https://app/billing?ok',
				cancelUrl: 'https://app/billing/plans',
				metadata: { organizationId: 'org_42', planId: 'pro', period: 'monthly' },
			}),
		).resolves.toStrictEqual({ id: 'txn_1', url: 'https://app.example.com/checkout?_ptxn=txn_1', expiresAt: null });

		expect(create).toHaveBeenCalledWith({
			items: [{ priceId: 'pri_pro', quantity: 3 }],
			customerId: 'ctm_1',
			customData: { organizationId: 'org_42', planId: 'pro', period: 'monthly' },
			checkout: { url: 'https://app.example.com/checkout' },
		});
	});

	test('Leaves the checkout page to the default payment link and refuses a transaction without a link', async () => {
		const { client, driver } = setup();

		const create = vi.spyOn(client.transactions, 'create').mockResolvedValue({ id: 'txn_2', checkout: null } as never);

		await expect(
			driver.createCheckoutSession({ customerId: 'ctm_1', priceId: 'pri_pro', successUrl: 'a', cancelUrl: 'b' }),
		).rejects.toThrow('"checkoutUrl"');

		expect(create).toHaveBeenCalledWith({ items: [{ priceId: 'pri_pro', quantity: 1 }], customerId: 'ctm_1' });
	});

	test('Opens the customer portal', async () => {
		const { client, driver } = setup();

		const create = vi
			.spyOn(client.customerPortalSessions, 'create')
			.mockResolvedValue({ urls: { general: { overview: 'https://customer-portal.paddle.com/x' } } } as never);

		await expect(driver.createPortalSession({ customerId: 'ctm_1', returnUrl: 'https://app' })).resolves.toStrictEqual({
			url: 'https://customer-portal.paddle.com/x',
		});

		expect(create).toHaveBeenCalledWith('ctm_1', []);
	});

	test('Reads a subscription', async () => {
		const { client, driver } = setup();

		vi.spyOn(client.subscriptions, 'get').mockResolvedValue(apiSubscription('subscription.created'));

		await expect(driver.getSubscription('sub_01h7zcgmdc8n1v3ypn6pkqtb3s')).resolves.toMatchObject({
			id: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s',
			status: 'active',
			priceId: 'pri_01gsz8x8sawmvhz1pv30nge1ke',
			quantity: 3,
		});
	});

	test('Rewrites the item with the new price and/or quantity, the proration mapped', async () => {
		const { client, driver } = setup();

		vi.spyOn(client.subscriptions, 'get').mockResolvedValue(apiSubscription('subscription.created'));
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(apiSubscription('subscription.created'));

		await driver.updateSubscription({ subscriptionId: 'sub_1', priceId: 'pri_business', proration: 'invoice' });

		expect(update).toHaveBeenCalledWith('sub_1', {
			items: [{ priceId: 'pri_business', quantity: 3 }],
			prorationBillingMode: PRORATION.invoice,
		});

		await driver.updateSubscription({ subscriptionId: 'sub_1', quantity: 5 });

		expect(update).toHaveBeenLastCalledWith('sub_1', {
			items: [{ priceId: 'pri_01gsz8x8sawmvhz1pv30nge1ke', quantity: 5 }],
			prorationBillingMode: PRORATION.prorate,
		});

		await expect(driver.updateSubscription({ subscriptionId: 'sub_1' })).rejects.toThrow('Nothing to update');
	});

	test('Cancels at the end of the period or right away', async () => {
		const { client, driver } = setup();
		const cancel = vi.spyOn(client.subscriptions, 'cancel').mockResolvedValue(apiSubscription('subscription.updated'));

		await expect(driver.cancelSubscription({ subscriptionId: 'sub_1', reason: 'too pricey' })).resolves.toMatchObject({
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000Z'),
		});

		expect(cancel).toHaveBeenCalledWith('sub_1', { effectiveFrom: 'next_billing_period' });

		await driver.cancelSubscription({ subscriptionId: 'sub_1', immediately: true });
		expect(cancel).toHaveBeenLastCalledWith('sub_1', { effectiveFrom: 'immediately' });
	});

	test('Lists the billed transactions of a customer as invoices', async () => {
		const { client, driver } = setup();

		const { data } = JSON.parse(fixtureText('transaction.completed')) as {
			data: ConstructorParameters<typeof Transaction>[0];
		};

		const list = vi.spyOn(client.transactions, 'list').mockReturnValue({
			next: async () => [new Transaction(data)],
		} as never);

		const invoices = await driver.listInvoices({ customerId: 'ctm_1', limit: 5 });

		expect(list).toHaveBeenCalledWith({
			customerId: ['ctm_1'],
			status: ['billed', 'paid', 'completed', 'past_due', 'canceled'],
			orderBy: 'created_at[DESC]',
			perPage: 5,
		});

		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({ id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t', status: 'paid', number: '325-10001' });
	});

	test('Verifies a webhook and refuses a bad or missing signature', async () => {
		const { driver } = setup();
		const body = fixtureText('subscription.created');

		const event = await driver.parseWebhook(body, { 'paddle-signature': sign(body) });

		expect(event).toMatchObject({
			type: 'subscription.created',
			provider: 'paddle',
			id: 'evt_01h7zcgmdc8n1v3ypn6pkqtb5a',
		});

		await expect(driver.parseWebhook(body, {})).rejects.toBeInstanceOf(InvalidPayloadError);

		await expect(driver.parseWebhook(body, { 'paddle-signature': sign(body, 'other') })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		await expect(driver.parseWebhook(body, { 'paddle-signature': 'garbage' })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		// 1. A signature older than the SDK's tolerance is refused as well
		await expect(
			driver.parseWebhook(body, { 'paddle-signature': sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 60) }),
		).rejects.toBeInstanceOf(InvalidCredentialsError);

		// 2. A verified body that is not an event is the sender's problem
		const junk = '{"hello":1}';

		await expect(driver.parseWebhook(junk, { 'paddle-signature': sign(junk) })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);
	});

	test('Drops a verified event the kit does not act on', async () => {
		const { driver } = setup();
		const body = fixtureText('customer.updated');

		await expect(driver.parseWebhook(body, { 'paddle-signature': sign(body) })).resolves.toBeNull();
	});

	test('Verifies the key with a cheap read', async () => {
		const { client, driver } = setup();
		const list = vi.spyOn(client.eventTypes, 'list').mockResolvedValue([] as never);

		await driver.verify();
		expect(list).toHaveBeenCalled();
	});
});

describe('toSubscription', () => {
	test('Maps a subscription: the first item’s price and quantity, the period, a scheduled cancellation', () => {
		expect(toSubscription(parsed('subscription.updated').data as never)).toStrictEqual({
			id: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s',
			customerId: 'ctm_01h7zcgmdc8n1v3ypn6pkqtb3r',
			status: 'active',
			priceId: 'pri_01gsz8x8sawmvhz1pv30nge1ke',
			productId: 'pro_01gsz4t5hdjse780zja8vvr7jg',
			quantity: 3,
			interval: 'month',
			currentPeriodStart: new Date('2026-09-01T10:00:00.000Z'),
			currentPeriodEnd: new Date('2026-10-01T10:00:00.000Z'),
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000Z'),
			canceledAt: null,
			trialEnd: null,
			endedAt: null,
			metadata: { organizationId: 'org_123', planId: 'pro', period: 'monthly' },
		});
	});

	test('A canceled subscription is over: canceledAt doubles as endedAt', () => {
		expect(toSubscription(parsed('subscription.canceled').data as never)).toMatchObject({
			status: 'canceled',
			canceledAt: new Date('2026-10-01T10:00:00.000Z'),
			endedAt: new Date('2026-10-01T10:00:00.000Z'),
			currentPeriodStart: null,
			cancelAtPeriodEnd: false,
		});
	});

	test('Refuses an unknown status and a subscription without items', () => {
		const data = parsed('subscription.created').data as never as Record<string, unknown>;

		expect(() => toSubscription({ ...data, status: 'frozen' } as never)).toThrow('unknown status');
		expect(() => toSubscription({ ...data, items: [] } as never)).toThrow('no items');
	});
});

describe('toInvoice', () => {
	test('A completed transaction is a paid invoice, paid when its payment was captured', () => {
		expect(toInvoice(parsed('transaction.completed').data as never)).toStrictEqual({
			id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t',
			number: '325-10001',
			customerId: 'ctm_01h7zcgmdc8n1v3ypn6pkqtb3r',
			subscriptionId: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s',
			status: 'paid',
			total: { amount: 10440, currency: 'USD' },
			amountPaid: 10440,
			amountDue: 0,
			createdAt: new Date('2026-09-01T09:59:50.000Z'),
			dueAt: null,
			paidAt: new Date('2026-09-01T10:00:03.000Z'),
			hostedUrl: null,
			pdfUrl: null,
		});
	});

	test('A past-due transaction is open, its balance due', () => {
		expect(toInvoice(parsed('transaction.payment_failed').data as never)).toMatchObject({
			status: 'open',
			amountPaid: 0,
			amountDue: 10440,
			paidAt: null,
		});
	});
});

describe('toEvent', () => {
	test('Maps the subscription and transaction events, drops the rest', () => {
		expect(toEvent(parsed('subscription.created'))).toMatchObject({
			id: 'evt_01h7zcgmdc8n1v3ypn6pkqtb5a',
			type: 'subscription.created',
			provider: 'paddle',
			occurredAt: new Date('2026-09-01T10:00:05.100Z'),
			subscription: { id: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s', status: 'active' },
		});

		expect(toEvent(parsed('subscription.updated'))).toMatchObject({ type: 'subscription.updated' });

		expect(toEvent(parsed('subscription.past_due'))).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'past_due' },
		});

		expect(toEvent(parsed('subscription.canceled'))).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled' },
		});

		expect(toEvent(parsed('transaction.completed'))).toMatchObject({
			type: 'invoice.paid',
			invoice: { id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t', status: 'paid' },
		});

		expect(toEvent(parsed('transaction.payment_failed'))).toMatchObject({
			type: 'invoice.failed',
			invoice: { id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3z', status: 'open' },
		});

		expect(toEvent(parsed('customer.updated'))).toBeNull();
	});
});

describe('toMetadata', () => {
	test('Strings stay, scalars are written out, nested values become JSON', () => {
		expect(toMetadata({ a: 'x', b: 2, c: true, d: { e: 1 }, f: [1, 2] })).toStrictEqual({
			a: 'x',
			b: '2',
			c: 'true',
			d: '{"e":1}',
			f: '[1,2]',
		});

		expect(toMetadata(null)).toStrictEqual({});
	});
});
