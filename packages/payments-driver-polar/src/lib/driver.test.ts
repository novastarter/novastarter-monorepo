/**
 * Tests of the Polar driver: the resources stubbed on a real client, the webhooks signed the way Polar signs them
 * (Standard Webhooks) and read from fixtures that pass the SDK's own schemas.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { Polar } from '@polar-sh/sdk';
import { validateEvent } from '@polar-sh/sdk/webhooks';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PaymentsDriverPolar } from './driver.js';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'polar-webhook-secret';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Polar event type it carries.
 * @returns The JSON text.
 */
const fixtureText = (name: string): string =>
	readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');

/**
 * Standard Webhooks headers for a body: `v1,<base64 hmac of "id.timestamp.body">` with the raw secret as the key,
 * which is what Polar's `validateEvent` expects after it base64-encodes the secret for the library.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @param id - The delivery id.
 * @returns The three headers.
 */
const sign = (body: string, secret = WEBHOOK_SECRET, id = 'msg_2abc') => {
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = `v1,${createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')}`;

	return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature };
};

/**
 * A fixture through the SDK's own parser, for the mapping tests.
 *
 * @param name - The fixture.
 * @returns What `validateEvent` hands the driver.
 */
const parsed = (name: string) => {
	const body = fixtureText(name);

	return validateEvent(body, sign(body), WEBHOOK_SECRET);
};

/**
 * A driver on a real client whose resources are stubbed — no network, real webhook verification.
 *
 * @returns The driver and the client to stub on.
 */
const setup = () => {
	const client = new Polar({ accessToken: 'polar_oat_x', server: 'sandbox' });
	const driver = new PaymentsDriverPolar({ accessToken: 'polar_oat_x', webhookSecret: WEBHOOK_SECRET, client });

	return { client, driver };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('PaymentsDriverPolar', () => {
	test('Refuses to start without a token or a webhook secret', () => {
		expect(() => new PaymentsDriverPolar({ accessToken: '', webhookSecret: 's' })).toThrow('"accessToken"');
		expect(() => new PaymentsDriverPolar({ accessToken: 't', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test('Creates a customer with the organization in its metadata, values as strings', async () => {
		const { client, driver } = setup();

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

		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42' },
		});
	});

	test('Starts a checkout for the product, with seats, a trial in days and the metadata', async () => {
		const { client, driver } = setup();
		const expiresAt = new Date('2026-09-10T12:55:00Z');

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

		vi.spyOn(client.subscriptions, 'get').mockResolvedValue(subscription as never);
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(subscription as never);

		await expect(driver.getSubscription(subscription!.id)).resolves.toMatchObject({ status: 'trialing', quantity: 3 });

		// 1. A plan change and a seat change are two Polar updates, each with the proration asked for
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

		await driver.updateSubscription({ subscriptionId: 'sub_1', quantity: 4, proration: 'none' });

		expect(update).toHaveBeenLastCalledWith({
			id: 'sub_1',
			subscriptionUpdate: { seats: 4, prorationBehavior: 'next_period' },
		});

		await expect(driver.updateSubscription({ subscriptionId: 'sub_1' })).rejects.toThrow('Nothing to update');

		// 2. Cancelling at period end and revoking are both updates, with the reason as the customer's comment
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

		const list = vi.spyOn(client.orders, 'list').mockResolvedValue({ result: { items: [order] } } as never);

		await expect(driver.listInvoices({ customerId: 'cust_1', limit: 10 })).resolves.toStrictEqual([toInvoice(order!)]);
		expect(list).toHaveBeenCalledWith({ customerId: 'cust_1', sorting: ['-created_at'], limit: 10 });
	});

	test('Verifies a signed webhook and refuses a wrong signature, missing headers and a broken body', async () => {
		const { driver } = setup();
		const body = fixtureText('subscription.created');

		await expect(driver.parseWebhook(body, sign(body))).resolves.toMatchObject({
			id: 'msg_2abc',
			type: 'subscription.created',
			provider: 'polar',
		});

		await expect(driver.parseWebhook(body, sign(body, 'other'))).rejects.toBeInstanceOf(InvalidCredentialsError);
		await expect(driver.parseWebhook(`${body} `, sign(body))).rejects.toBeInstanceOf(InvalidCredentialsError);

		const headers = sign(body);

		await expect(driver.parseWebhook(body, { 'webhook-id': headers['webhook-id'] })).rejects.toThrow(
			'no webhook-timestamp header',
		);

		// 1. A verified body that is not an event at all is a payload problem; one of a type this SDK does not know
		//    is dropped, since Polar adds event types over time
		await expect(driver.parseWebhook('{"hello":1}', sign('{"hello":1}'))).rejects.toBeInstanceOf(InvalidPayloadError);

		const unknown = JSON.stringify({ type: 'wallet.topped_up', timestamp: '2026-09-10T12:00:00Z', data: {} });

		await expect(driver.parseWebhook(unknown, sign(unknown))).resolves.toBeNull();
	});

	test('Verifies the token with the cheapest read', async () => {
		const { client, driver } = setup();
		const list = vi.spyOn(client.customers, 'list').mockResolvedValue({ result: { items: [] } } as never);

		await driver.verify();

		expect(list).toHaveBeenCalledWith({ limit: 1 });
	});
});

describe('toSubscription', () => {
	test('Maps the product as the price, seats, the period and the cancellation dates', () => {
		const event = parsed('subscription.updated');
		const subscription = toSubscription(event.type === 'subscription.updated' ? event.data : (undefined as never));

		expect(subscription).toStrictEqual({
			id: 'd9c8b7a6-5555-4e55-9a55-000000000005',
			customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
			status: 'active',
			priceId: 'a1b2c3d4-3333-4c33-9e33-000000000003',
			productId: 'a1b2c3d4-3333-4c33-9e33-000000000003',
			quantity: 5,
			interval: 'month',
			currentPeriodStart: new Date('2026-09-10T12:00:00Z'),
			currentPeriodEnd: new Date('2026-10-10T12:00:00Z'),
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-10T12:00:00Z'),
			canceledAt: new Date('2026-09-20T12:00:00Z'),
			trialEnd: new Date('2026-09-24T12:00:00Z'),
			endedAt: null,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});

	test('Refuses a status it does not know', () => {
		const event = parsed('subscription.created');
		const subscription = event.type === 'subscription.created' ? event.data : (undefined as never);

		expect(() => toSubscription({ ...subscription, status: 'frozen' as never })).toThrow('unknown status "frozen"');
	});
});

describe('toInvoice', () => {
	test('Maps a paid order as a paid invoice', () => {
		const event = parsed('order.paid');

		expect(toInvoice(event.type === 'order.paid' ? event.data : (undefined as never))).toStrictEqual({
			id: 'f0e1d2c3-7777-4a77-9c77-000000000007',
			number: 'NOVA-0001',
			customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
			subscriptionId: 'd9c8b7a6-5555-4e55-9a55-000000000005',
			status: 'paid',
			total: { amount: 9500, currency: 'usd' },
			amountPaid: 9500,
			amountDue: 0,
			createdAt: new Date('2026-10-10T12:00:00Z'),
			dueAt: null,
			paidAt: new Date('2026-10-10T12:00:00Z'),
			hostedUrl: null,
			pdfUrl: null,
		});
	});
});

describe('toEvent', () => {
	test('Maps the events the kit acts on and drops the rest', () => {
		expect(toEvent(parsed('checkout.updated'), 'msg_1')).toMatchObject({
			id: 'msg_1',
			type: 'checkout.completed',
			provider: 'polar',
			occurredAt: new Date('2026-09-10T12:00:00Z'),
			checkout: {
				id: 'b2a1c0d9-6666-4f66-8b66-000000000006',
				customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
				subscriptionId: 'd9c8b7a6-5555-4e55-9a55-000000000005',
				metadata: { organizationId: 'org_42', planId: 'pro' },
			},
		});

		// 1. A checkout still open is not a purchase yet
		expect(toEvent(parsed('checkout.updated.open'), 'msg_0')).toBeNull();

		expect(toEvent(parsed('subscription.created'), 'msg_2')).toMatchObject({
			type: 'subscription.created',
			subscription: { status: 'trialing', quantity: 3 },
		});

		expect(toEvent(parsed('subscription.updated'), 'msg_3')).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'active', cancelAtPeriodEnd: true },
		});

		// 2. The specific subscription events repeat what `subscription.updated` already said
		expect(toEvent(parsed('subscription.active'), 'msg_4')).toBeNull();

		expect(toEvent(parsed('subscription.revoked'), 'msg_5')).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled', endedAt: new Date('2026-10-10T12:00:00Z') },
		});

		expect(toEvent(parsed('order.paid'), 'msg_6')).toMatchObject({ type: 'invoice.paid', invoice: { status: 'paid' } });

		// 3. The raw payload rides along for the audit trail
		expect(toEvent(parsed('order.paid'), 'msg_6')?.raw).toStrictEqual(parsed('order.paid'));
	});
});

describe('toMetadata', () => {
	test('Writes every value out as a string', () => {
		expect(toMetadata({ a: 'x', b: 2, c: true })).toStrictEqual({ a: 'x', b: '2', c: 'true' });
		expect(toMetadata(null)).toStrictEqual({});
	});
});
