/**
 * Tests of the Lemon Squeezy driver on a fake fetch — the JSON:API requests recorded, the responses queued — and
 * webhooks signed the way Lemon Squeezy signs them (hex HMAC-SHA256 of the body), read from fixtures in the shape of
 * its documented payloads.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import type { LsSubscriptionAttributes, LsSubscriptionInvoiceAttributes, LsWebhookPayload } from '../types.js';
import { type ApiFetch, LemonSqueezyApi, LemonSqueezyApiError } from './api.js';
import { PaymentsDriverLemonSqueezy } from './driver.js';
import { deliveryIdOf, toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';
import { verifySignature } from './verify-signature.js';

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'lemon-signing-secret';

/**
 * A fixture, as text — the bytes a signature covers.
 *
 * @param name - The file, named after the Lemon Squeezy event it carries.
 * @returns The JSON text.
 */
const fixtureText = (name: string): string =>
	readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');

/**
 * A fixture, parsed.
 *
 * @param name - The fixture.
 * @returns The delivery.
 */
const fixture = <A = unknown>(name: string): LsWebhookPayload<A> =>
	JSON.parse(fixtureText(name)) as LsWebhookPayload<A>;

/**
 * The `X-Signature` of a body.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @returns The hex digest.
 */
const sign = (body: string, secret = WEBHOOK_SECRET): string => createHmac('sha256', secret).update(body).digest('hex');

/**
 * A recorded request of the fake fetch.
 */
interface Call {
	method: string;
	url: string;
	body: unknown;
	headers: Record<string, string>;
}

/**
 * A fake fetch: answers from a queue of responses, records what was asked.
 *
 * @param responses - The responses, in order; a `status` other than 2xx is a refusal.
 * @returns The fetch and the calls it saw.
 */
const fakeFetch = (responses: { status?: number; body?: unknown }[]) => {
	const calls: Call[] = [];

	const fetch: ApiFetch = async (url, init) => {
		calls.push({
			method: init.method,
			url,
			body: init.body ? JSON.parse(init.body) : undefined,
			headers: init.headers,
		});

		const next = responses.shift() ?? { status: 200, body: {} };
		const status = next.status ?? 200;

		return {
			status,
			ok: status >= 200 && status < 300,
			text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
		};
	};

	return { fetch, calls };
};

/** The variant resource, as `GET /variants/222` answers. */
const variant = {
	data: {
		type: 'variants',
		id: '222',
		attributes: { product_id: 111, name: 'Monthly', is_subscription: true, interval: 'month', interval_count: 1 },
	},
};

/** The customer resource, as `GET /customers/987` answers. */
const customer = {
	data: {
		type: 'customers',
		id: '987',
		attributes: {
			store_id: 12345,
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			status: 'subscribed',
			urls: { customer_portal: 'https://acme.lemonsqueezy.com/billing?expires=1&signature=y' },
			created_at: '2026-09-01T09:00:00.000000Z',
			updated_at: '2026-09-01T09:00:00.000000Z',
		},
	},
};

/**
 * A driver on a fake fetch.
 *
 * @param responses - The responses the API will give, in order.
 * @returns The driver and the recorded calls.
 */
const setup = (responses: { status?: number; body?: unknown }[]) => {
	const { fetch, calls } = fakeFetch(responses);

	const driver = new PaymentsDriverLemonSqueezy({
		apiKey: 'lemon-key',
		webhookSecret: WEBHOOK_SECRET,
		storeId: 12345,
		fetch,
	});

	return { driver, calls };
};

describe('LemonSqueezyApi', () => {
	test('Sends the JSON:API headers and the bearer, reads a refusal into an error', async () => {
		const { fetch, calls } = fakeFetch([
			{ status: 200, body: { data: { id: '1' } } },
			{ status: 401, body: { errors: [{ status: '401', title: 'Unauthenticated', detail: 'Bad key' }] } },
			{ status: 500, body: undefined },
		]);

		const api = new LemonSqueezyApi({ apiKey: 'k', fetch, apiUrl: 'https://stand-in.test/v1/' });

		await expect(api.request('GET', '/users/me')).resolves.toStrictEqual({ data: { id: '1' } });

		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://stand-in.test/v1/users/me',
			headers: {
				Authorization: 'Bearer k',
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json',
			},
		});

		const refusal = await api.request('GET', '/users/me').catch((error: unknown) => error);

		expect(refusal).toBeInstanceOf(LemonSqueezyApiError);
		expect((refusal as LemonSqueezyApiError).message).toBe('Lemon Squeezy 401: Bad key');
		expect((refusal as LemonSqueezyApiError).status).toBe(401);

		await expect(api.request('GET', '/users/me')).rejects.toThrow('Lemon Squeezy 500: request failed');
	});
});

describe('verifySignature', () => {
	test('Accepts the body’s digest under the secret, refuses anything else without throwing', () => {
		const body = '{"a":1}';

		expect(verifySignature(body, sign(body), WEBHOOK_SECRET)).toBe(true);
		expect(verifySignature(body, sign(body, 'other'), WEBHOOK_SECRET)).toBe(false);
		expect(verifySignature(body, 'short', WEBHOOK_SECRET)).toBe(false);
	});
});

describe('PaymentsDriverLemonSqueezy', () => {
	test('Refuses to start without a key, a webhook secret or a store', () => {
		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: '', webhookSecret: 's', storeId: 1 })).toThrow('"apiKey"');

		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: '', storeId: 1 })).toThrow(
			'"webhookSecret"',
		);

		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: 's', storeId: '' })).toThrow('"storeId"');
	});

	test('Creates a customer in the store', async () => {
		const { driver, calls } = setup([{ body: customer }]);

		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada Lovelace', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({ id: '987', email: 'ada@example.com', name: 'Ada Lovelace', metadata: {} });

		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: 'https://api.lemonsqueezy.com/v1/customers',
			body: {
				data: {
					type: 'customers',
					attributes: { email: 'ada@example.com', name: 'Ada Lovelace' },
					relationships: { store: { data: { type: 'stores', id: '12345' } } },
				},
			},
		});
	});

	test('Starts a checkout for the variant, prefilled with the customer, with the seats and the custom data', async () => {
		const { driver, calls } = setup([
			{ body: customer },
			{
				body: {
					data: {
						type: 'checkouts',
						id: 'chk_1',
						attributes: {
							store_id: 12345,
							variant_id: 222,
							url: 'https://acme.lemonsqueezy.com/checkout/custom/chk_1',
							expires_at: '2026-09-02T10:00:00.000000Z',
							created_at: '2026-09-01T10:00:00.000000Z',
						},
					},
				},
			},
		]);

		await expect(
			driver.createCheckoutSession({
				customerId: '987',
				priceId: '222',
				quantity: 3,
				successUrl: 'https://app/billing?ok',
				cancelUrl: 'https://app/billing/plans',
				allowPromotionCodes: false,
				metadata: { organizationId: 'org_42', planId: 'pro', period: 'monthly' },
			}),
		).resolves.toStrictEqual({
			id: 'chk_1',
			url: 'https://acme.lemonsqueezy.com/checkout/custom/chk_1',
			expiresAt: new Date('2026-09-02T10:00:00.000000Z'),
		});

		expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.lemonsqueezy.com/v1/customers/987' });

		expect(calls[1]).toMatchObject({
			method: 'POST',
			url: 'https://api.lemonsqueezy.com/v1/checkouts',
			body: {
				data: {
					type: 'checkouts',
					attributes: {
						checkout_data: {
							email: 'ada@example.com',
							name: 'Ada Lovelace',
							custom: { organizationId: 'org_42', planId: 'pro', period: 'monthly' },
							variant_quantities: [{ variant_id: 222, quantity: 3 }],
						},
						product_options: { redirect_url: 'https://app/billing?ok', enabled_variants: [222] },
						checkout_options: { discount: false },
					},
					relationships: {
						store: { data: { type: 'stores', id: '12345' } },
						variant: { data: { type: 'variants', id: '222' } },
					},
				},
			},
		});
	});

	test('Opens the customer portal from the customer’s signed link, or says there is none', async () => {
		const { driver } = setup([
			{ body: customer },
			{
				body: {
					data: { ...customer.data, attributes: { ...customer.data.attributes, urls: { customer_portal: null } } },
				},
			},
		]);

		await expect(driver.createPortalSession({ customerId: '987', returnUrl: 'https://app' })).resolves.toStrictEqual({
			url: 'https://acme.lemonsqueezy.com/billing?expires=1&signature=y',
		});

		await expect(driver.createPortalSession({ customerId: '987', returnUrl: 'https://app' })).rejects.toThrow(
			'no customer portal yet',
		);
	});

	test('Reads a subscription, the interval from its variant — once', async () => {
		const subscription = { data: fixture('subscription_created').data };
		const { driver, calls } = setup([{ body: subscription }, { body: variant }, { body: subscription }]);

		await expect(driver.getSubscription('3001')).resolves.toMatchObject({
			id: '3001',
			status: 'active',
			priceId: '222',
			interval: 'month',
			quantity: 3,
			metadata: {},
		});

		await driver.getSubscription('3001');

		expect(calls.map((call) => call.url)).toStrictEqual([
			'https://api.lemonsqueezy.com/v1/subscriptions/3001',
			'https://api.lemonsqueezy.com/v1/variants/222',
			'https://api.lemonsqueezy.com/v1/subscriptions/3001',
		]);
	});

	test('Changes the variant on the subscription and the seats on its item, then reads it back', async () => {
		const subscription = { data: fixture('subscription_created').data };

		const { driver, calls } = setup([
			{ body: subscription },
			{ body: subscription },
			{ body: {} },
			{ body: subscription },
			{ body: variant },
		]);

		await driver.updateSubscription({ subscriptionId: '3001', priceId: '333', quantity: 5, proration: 'invoice' });

		expect(calls[0]).toMatchObject({
			method: 'PATCH',
			url: 'https://api.lemonsqueezy.com/v1/subscriptions/3001',
			body: {
				data: {
					type: 'subscriptions',
					id: '3001',
					attributes: { variant_id: 333, invoice_immediately: true, disable_prorations: false },
				},
			},
		});

		expect(calls[2]).toMatchObject({
			method: 'PATCH',
			url: 'https://api.lemonsqueezy.com/v1/subscription-items/7001',
			body: {
				data: { type: 'subscription-items', id: '7001', attributes: { quantity: 5, invoice_immediately: true } },
			},
		});

		await expect(driver.updateSubscription({ subscriptionId: '3001' })).rejects.toThrow('Nothing to update');
	});

	test('Cancels at the end of the period', async () => {
		const { driver, calls } = setup([{ body: { data: fixture('subscription_cancelled').data } }, { body: variant }]);

		await expect(driver.cancelSubscription({ subscriptionId: '3001', immediately: true })).resolves.toMatchObject({
			status: 'active',
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000000Z'),
		});

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.lemonsqueezy.com/v1/subscriptions/3001' });
	});

	test('Lists the invoices of the customer’s subscriptions, most recent first', async () => {
		const paid = fixture<LsSubscriptionInvoiceAttributes>('subscription_payment_success').data;
		const pending = fixture<LsSubscriptionInvoiceAttributes>('subscription_payment_failed').data;
		const mine = fixture<LsSubscriptionAttributes>('subscription_created').data;
		const other = { ...mine, id: '3002', attributes: { ...mine.attributes, customer_id: 1 } };

		const later = {
			...pending,
			id: '9002',
			attributes: { ...pending.attributes, created_at: '2026-11-01T10:00:00.000000Z' },
		};

		const { driver, calls } = setup([
			{ body: customer },
			{ body: { data: [mine, other] } },
			{ body: { data: [paid, later] } },
		]);

		const invoices = await driver.listInvoices({ customerId: '987', limit: 10 });

		expect(calls[1]?.url).toBe(
			'https://api.lemonsqueezy.com/v1/subscriptions?filter[store_id]=12345&filter[user_email]=ada%40example.com',
		);

		// 1. The other customer's subscription with the same email is left out: one invoices read
		expect(calls).toHaveLength(3);

		expect(calls[2]?.url).toBe(
			'https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=3001&page[size]=10',
		);

		expect(invoices.map((invoice) => invoice.id)).toStrictEqual(['9002', '9001']);
	});

	test('Verifies a webhook and refuses a bad or missing signature, or a body that is not an event', async () => {
		const { driver } = setup([{ body: variant }]);
		const body = fixtureText('subscription_created');

		await expect(driver.parseWebhook(body, { 'x-signature': sign(body) })).resolves.toMatchObject({
			id: 'wh_2',
			type: 'subscription.created',
			provider: 'lemonsqueezy',
			subscription: { id: '3001', interval: 'month', metadata: { organizationId: 'org_123' } },
		});

		await expect(driver.parseWebhook(body, {})).rejects.toBeInstanceOf(InvalidPayloadError);

		await expect(driver.parseWebhook(body, { 'x-signature': sign(body, 'other') })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		const junk = '{"hello":1}';

		await expect(driver.parseWebhook(junk, { 'x-signature': sign(junk) })).rejects.toBeInstanceOf(InvalidPayloadError);

		await expect(driver.parseWebhook('nope', { 'x-signature': sign('nope') })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);
	});

	test('Drops a verified event the kit does not act on', async () => {
		const { driver } = setup([]);
		const body = fixtureText('license_key_created');

		await expect(driver.parseWebhook(body, { 'x-signature': sign(body) })).resolves.toBeNull();
	});

	test('Verifies the key with the authenticated user', async () => {
		const { driver, calls } = setup([{ body: { data: { id: '1' } } }]);

		await driver.verify();
		expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.lemonsqueezy.com/v1/users/me' });
	});
});

describe('toSubscription', () => {
	test('Maps a subscription: the variant as the price, the first item’s seats, the renewal as the period end', () => {
		expect(
			toSubscription(fixture('subscription_created').data as never, { interval: 'month', metadata: { a: 'b' } }),
		).toStrictEqual({
			id: '3001',
			customerId: '987',
			status: 'active',
			priceId: '222',
			productId: '111',
			quantity: 3,
			interval: 'month',
			currentPeriodStart: null,
			currentPeriodEnd: new Date('2026-10-01T10:00:00.000000Z'),
			cancelAtPeriodEnd: false,
			cancelAt: null,
			canceledAt: null,
			trialEnd: null,
			endedAt: null,
			metadata: { a: 'b' },
		});
	});

	test('A cancelled subscription is active on its grace period; an expired one is over', () => {
		expect(toSubscription(fixture('subscription_cancelled').data as never, { interval: 'month' })).toMatchObject({
			status: 'active',
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000000Z'),
			canceledAt: new Date('2026-09-15T12:00:00.000000Z'),
			endedAt: null,
		});

		expect(toSubscription(fixture('subscription_expired').data as never, { interval: 'month' })).toMatchObject({
			status: 'canceled',
			cancelAtPeriodEnd: false,
			endedAt: new Date('2026-10-01T10:00:00.000000Z'),
		});
	});

	test('Refuses an unknown status', () => {
		const data = fixture('subscription_created').data as { attributes: Record<string, unknown> };

		expect(() =>
			toSubscription({ ...data, attributes: { ...data.attributes, status: 'frozen' } } as never, { interval: 'month' }),
		).toThrow('unknown status');
	});
});

describe('toInvoice', () => {
	test('A paid subscription invoice, with its hosted link', () => {
		expect(toInvoice(fixture('subscription_payment_success').data as never)).toStrictEqual({
			id: '9001',
			number: null,
			customerId: '987',
			subscriptionId: '3001',
			status: 'paid',
			total: { amount: 10440, currency: 'USD' },
			amountPaid: 10440,
			amountDue: 0,
			createdAt: new Date('2026-10-01T10:00:00.000000Z'),
			dueAt: null,
			paidAt: new Date('2026-10-01T10:00:00.000000Z'),
			hostedUrl: 'https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/9001?signature=s',
			pdfUrl: null,
		});

		expect(toInvoice(fixture('subscription_payment_failed').data as never)).toMatchObject({
			status: 'open',
			amountPaid: 0,
			amountDue: 10440,
			paidAt: null,
		});
	});
});

describe('toEvent', () => {
	const intervalOf = async () => 'month' as const;

	test('Maps the order, subscription and payment events, drops the rest', async () => {
		await expect(toEvent(fixture('order_created'), intervalOf)).resolves.toMatchObject({
			id: 'wh_1',
			type: 'checkout.completed',
			provider: 'lemonsqueezy',
			occurredAt: new Date('2026-09-01T10:00:00.000000Z'),
			checkout: { id: '5001', customerId: '987', subscriptionId: null, metadata: { organizationId: 'org_123' } },
		});

		await expect(toEvent(fixture('subscription_created'), intervalOf)).resolves.toMatchObject({
			type: 'subscription.created',
			subscription: { id: '3001', status: 'active', metadata: { organizationId: 'org_123', planId: 'pro' } },
		});

		await expect(toEvent(fixture('subscription_cancelled'), intervalOf)).resolves.toMatchObject({
			// 1. No `webhook_id` in this fixture: the id is derived from the event, the resource and its update time
			id: 'subscription_cancelled:3001:2026-09-15T12:00:00.000000Z',
			type: 'subscription.updated',
			subscription: { cancelAtPeriodEnd: true },
		});

		await expect(toEvent(fixture('subscription_expired'), intervalOf)).resolves.toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled' },
		});

		await expect(toEvent(fixture('subscription_payment_success'), intervalOf)).resolves.toMatchObject({
			type: 'invoice.paid',
			invoice: { id: '9001', status: 'paid' },
		});

		await expect(toEvent(fixture('subscription_payment_failed'), intervalOf)).resolves.toMatchObject({
			type: 'invoice.failed',
			invoice: { id: '9001', status: 'open' },
		});

		await expect(toEvent(fixture('license_key_created'), intervalOf)).resolves.toBeNull();
	});

	test('deliveryIdOf prefers the webhook id', () => {
		expect(deliveryIdOf(fixture('subscription_created'))).toBe('wh_2');
	});
});

describe('toMetadata', () => {
	test('Strings stay, scalars are written out, nested values become JSON', () => {
		expect(toMetadata({ a: 'x', b: 2, c: false, d: { e: 1 } })).toStrictEqual({
			a: 'x',
			b: '2',
			c: 'false',
			d: '{"e":1}',
		});

		expect(toMetadata(undefined)).toStrictEqual({});
	});
});
