/**
 * Tests of the Lemon Squeezy driver on a fake fetch — the JSON:API requests recorded, the responses queued — and
 * webhooks signed the way Lemon Squeezy signs them (hex HMAC-SHA256 of the body), read from fixtures in the shape of
 * its documented payloads. The client, the signature check and the mappings have their own test files next to them.
 */
import { createHmac } from 'node:crypto';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test, vi } from 'vitest';
import { fixture, fixtureText } from '../fixtures/index.js';
import type { LsSubscriptionAttributes, LsSubscriptionInvoiceAttributes } from '../types.js';
import type { ApiFetch } from './api.js';
import { PaymentsDriverLemonSqueezy } from './driver.js';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('@novastarter/logger', () => ({ useLogger: () => ({ warn: mockWarn }) }));

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'lemon-signing-secret';

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
	// The calls are kept outside the fetch, so a test reads them after the driver has sent.
	const calls: Call[] = [];

	/**
	 * Record the request and answer the next queued response.
	 *
	 * @param url - The requested URL.
	 * @param init - The method, headers and body of the request.
	 * @returns The queued response, or an empty success once the queue is empty.
	 */
	const fetch: ApiFetch = async (url, init) => {
		// The body is recorded parsed, so a test matches objects rather than JSON text.
		calls.push({
			method: init.method,
			url,
			body: init.body ? JSON.parse(init.body) : undefined,
			headers: init.headers,
		});

		// Past the queue the API answers an empty success, so a test only queues what it asserts on.
		const next = responses.shift() ?? { status: 200, body: {} };
		const status = next.status ?? 200;

		// `ok` follows the status the way the platform's response does; no body reads as empty text, like a 204. No
		// headers are needed, since `call()` reads them only for a redirect's `Location`.
		return {
			status,
			ok: status >= 200 && status < 300,
			headers: new Headers(),
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
 * The subscriptions list of the customer's email, as `GET /subscriptions?…&page[number]=n` answers.
 *
 * @param data - The subscriptions on the page.
 * @param page - Which page this is and how many there are.
 * @returns The list document.
 */
const subscriptionsPage = (data: unknown[], page: { currentPage: number; lastPage: number }) => ({
	data,
	meta: { page: { ...page, total: data.length } },
});

/**
 * A driver on a fake fetch.
 *
 * @param responses - The responses the API will give, in order.
 * @returns The driver and the recorded calls.
 */
const setup = (responses: { status?: number; body?: unknown }[]) => {
	// The same store and secret as the fixtures, so a signed fixture verifies and the store id matches.
	const { fetch, calls } = fakeFetch(responses);

	const driver = new PaymentsDriverLemonSqueezy({
		apiKey: 'lemon-key',
		webhookSecret: WEBHOOK_SECRET,
		storeId: 12345,
		fetch,
	});

	return { driver, calls };
};

describe('PaymentsDriverLemonSqueezy', () => {
	test('Refuses to start without a key, a webhook secret or a store', () => {
		// Each missing value is named, so a misconfigured location says what it lacks.
		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: '', webhookSecret: 's', storeId: 1 })).toThrow('"apiKey"');

		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: '', storeId: 1 })).toThrow(
			'"webhookSecret"',
		);

		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: 's', storeId: '' })).toThrow('"storeId"');
	});

	test('Refuses a timeout the request signal cannot hold, at registration', () => {
		// A misconfigured timeout fails the location now, not every request later with an out-of-range error.
		expect(() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: 's', storeId: 1, timeout: -1 })).toThrow(
			RangeError,
		);

		expect(
			() => new PaymentsDriverLemonSqueezy({ apiKey: 'k', webhookSecret: 's', storeId: 1, timeout: 2 ** 31 }),
		).toThrow('"timeout"');
	});

	test('Creates a customer in the store', async () => {
		const { driver, calls } = setup([{ body: customer }]);

		await expect(driver.createCustomer({ email: 'ada@example.com', name: 'Ada Lovelace' })).resolves.toStrictEqual({
			id: '987',
			email: 'ada@example.com',
			name: 'Ada Lovelace',
			metadata: {},
		});

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

	test('Refuses to create a customer with metadata, naming where the metadata can go', async () => {
		const { driver, calls } = setup([{ body: customer }]);

		// Lemon Squeezy customers carry no custom data, so the metadata would be lost silently; the refusal comes
		// before any request instead of a customer whose empty `metadata` hides the loss.
		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada Lovelace', metadata: { organizationId: 'org_42' } }),
		).rejects.toThrow('createCheckoutSession');

		expect(calls).toHaveLength(0);
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

		// The cancel URL has no place on Lemon Squeezy and is dropped.
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

		// The variant id is numeric in the quantities and the enabled list, a string in the relationship.
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

		// There is no session resource, so `returnUrl` has no effect.
		await expect(driver.createPortalSession({ customerId: '987', returnUrl: 'https://app' })).resolves.toStrictEqual({
			url: 'https://acme.lemonsqueezy.com/billing?expires=1&signature=y',
		});

		// The error says why rather than answering an empty URL.
		await expect(driver.createPortalSession({ customerId: '987', returnUrl: 'https://app' })).rejects.toThrow(
			'no customer portal yet',
		);
	});

	test('Reads a subscription, the interval from its variant — once', async () => {
		const subscription = { data: fixture('subscription_created').data };
		const { driver, calls } = setup([{ body: subscription }, { body: variant }, { body: subscription }]);

		// The subscription does not carry its interval; the variant does.
		await expect(driver.getSubscription('3001')).resolves.toMatchObject({
			id: '3001',
			status: 'active',
			priceId: '222',
			interval: 'month',
			quantity: 3,
			metadata: {},
		});

		// A second read of the same variant is served from the cache: three calls, not four.
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
				data: {
					type: 'subscription-items',
					id: '7001',
					attributes: { quantity: 5, invoice_immediately: true, disable_prorations: false },
				},
			},
		});

		await expect(driver.updateSubscription({ subscriptionId: '3001' })).rejects.toThrow('Nothing to update');
	});

	test('Refuses a variant change whose price id is not a positive integer, before any request', async () => {
		const { driver, calls } = setup([]);

		// The API would refuse the JSON `null` a non-numeric id becomes with a message that does not name the cause, so
		// the driver names it instead, without asking.
		await expect(driver.updateSubscription({ subscriptionId: '3001', priceId: 'abc' })).rejects.toThrow('"priceId"');

		expect(calls).toHaveLength(0);
	});

	test('Skips the proration on a seat change alone when asked not to prorate', async () => {
		const subscription = { data: fixture('subscription_created').data };

		const { driver, calls } = setup([{ body: subscription }, { body: {} }, { body: subscription }, { body: variant }]);

		await driver.updateSubscription({ subscriptionId: '3001', quantity: 10, proration: 'none' });

		// Without the flag Lemon Squeezy would prorate the seats at the next renewal.
		expect(calls[1]).toMatchObject({
			method: 'PATCH',
			url: 'https://api.lemonsqueezy.com/v1/subscription-items/7001',
			body: {
				data: {
					type: 'subscription-items',
					id: '7001',
					attributes: { quantity: 10, invoice_immediately: false, disable_prorations: true },
				},
			},
		});
	});

	test('Cancels at the end of the period', async () => {
		const { driver, calls } = setup([{ body: { data: fixture('subscription_cancelled').data } }, { body: variant }]);

		await expect(driver.cancelSubscription({ subscriptionId: '3001' })).resolves.toMatchObject({
			status: 'active',
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000000Z'),
		});

		expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.lemonsqueezy.com/v1/subscriptions/3001' });
	});

	test('Refuses an immediate cancellation without a request', async () => {
		const { driver, calls } = setup([]);

		// `immediately` has no counterpart: it is refused rather than quietly downgraded to a period-end cancellation.
		await expect(driver.cancelSubscription({ subscriptionId: '3001', immediately: true })).rejects.toThrow(
			/cannot end a subscription immediately/,
		);

		expect(calls).toHaveLength(0);
	});

	test('Lists the invoices of the customer’s subscriptions, most recent first', async () => {
		const paid = fixture<LsSubscriptionInvoiceAttributes>('subscription_payment_success').data;
		const pending = fixture<LsSubscriptionInvoiceAttributes>('subscription_payment_failed').data;
		const mine = fixture<LsSubscriptionAttributes>('subscription_created').data;

		// Another customer of the store shares the email, so the filter by email finds both subscriptions.
		const other = { ...mine, id: '3002', attributes: { ...mine.attributes, customer_id: 1 } };

		// A later invoice of the same subscription, to prove the order is by date and not by the API's.
		const later = {
			...pending,
			id: '9002',
			attributes: { ...pending.attributes, created_at: '2026-11-01T10:00:00.000000Z' },
		};

		const { driver, calls } = setup([
			{ body: customer },
			{ body: subscriptionsPage([mine, other], { currentPage: 1, lastPage: 1 }) },
			{ body: { data: [paid, later] } },
		]);

		const invoices = await driver.listInvoices({ customerId: '987', limit: 10 });

		expect(calls[1]?.url).toBe(
			'https://api.lemonsqueezy.com/v1/subscriptions?filter[store_id]=12345&filter[user_email]=ada%40example.com&page[size]=100&page[number]=1',
		);

		expect(calls).toHaveLength(3);

		expect(calls[2]?.url).toBe(
			'https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=3001&page[size]=10',
		);

		expect(invoices.map((invoice) => invoice.id)).toStrictEqual(['9002', '9001']);
	});

	test('Collects every page of the customer’s subscriptions before reading the invoices', async () => {
		const paid = fixture<LsSubscriptionInvoiceAttributes>('subscription_payment_success').data;
		const mine = fixture<LsSubscriptionAttributes>('subscription_created').data;

		// The customer's second subscription sits on the second page; an invoice of it is the most recent one.
		const second = { ...mine, id: '3003' };

		const latest = {
			...paid,
			id: '9003',
			attributes: { ...paid.attributes, subscription_id: 3003, created_at: '2026-12-01T10:00:00.000000Z' },
		};

		const { driver, calls } = setup([
			{ body: customer },
			{ body: subscriptionsPage([mine], { currentPage: 1, lastPage: 2 }) },
			{ body: subscriptionsPage([second], { currentPage: 2, lastPage: 2 }) },
			{ body: { data: [paid] } },
			{ body: { data: [latest] } },
		]);

		const invoices = await driver.listInvoices({ customerId: '987', limit: 10 });

		// A subscription on a later page counts too.
		expect(calls.slice(1, 3).map((call) => call.url)).toStrictEqual([
			'https://api.lemonsqueezy.com/v1/subscriptions?filter[store_id]=12345&filter[user_email]=ada%40example.com&page[size]=100&page[number]=1',
			'https://api.lemonsqueezy.com/v1/subscriptions?filter[store_id]=12345&filter[user_email]=ada%40example.com&page[size]=100&page[number]=2',
		]);

		expect(calls.slice(3).map((call) => call.url)).toStrictEqual([
			'https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=3001&page[size]=10',
			'https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=3003&page[size]=10',
		]);

		expect(invoices.map((invoice) => invoice.id)).toStrictEqual(['9003', '9001']);
	});

	test('Caps the subscription pages read and reports the truncation', async () => {
		const mine = fixture<LsSubscriptionAttributes>('subscription_created').data;

		// Every page claims eleven exist, so the loop would otherwise read on forever; the paged subscriptions belong
		// to another customer, so no invoice read follows.
		const other = {
			...mine,
			attributes: { ...mine.attributes, customer_id: 1 },
		};

		const { driver, calls } = setup([
			{ body: customer },
			...Array.from({ length: 10 }, (_, index) => ({
				body: subscriptionsPage([other], { currentPage: index + 1, lastPage: 11 }),
			})),
		]);

		mockWarn.mockClear();

		await driver.listInvoices({ customerId: '987', limit: 10 });

		// Ten pages at the largest page size is the cap.
		const subscriptionCalls = calls.filter((call) => call.url.includes('/v1/subscriptions?'));

		expect(subscriptionCalls).toHaveLength(10);
		expect(subscriptionCalls.at(-1)?.url).toContain('page[number]=10');
		expect(calls.some((call) => call.url.includes('/v1/subscription-invoices'))).toBe(false);
		expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('past page 10'));
	});

	test('Refuses a checkout for a price id that is not a positive integer, before any request', async () => {
		const { driver, calls } = setup([]);

		// A non-numeric price id would be sent as JSON `null` and refused by the API with a message that does not name
		// the cause.
		await expect(
			driver.createCheckoutSession({
				customerId: '987',
				priceId: 'abc',
				successUrl: 'https://app/billing?ok',
				cancelUrl: 'https://app/billing/plans',
			}),
		).rejects.toThrow('"priceId"');

		expect(calls).toHaveLength(0);
	});

	test('Verifies a webhook and refuses a bad or missing signature, or a body that is not an event', async () => {
		const { driver } = setup([{ body: variant }]);
		const body = fixtureText('subscription_created');

		// The id is derived from the event, the resource and its update time: `meta.webhook_id` is the endpoint's, not
		// the event's.
		await expect(driver.parseWebhook(body, { 'x-signature': sign(body) })).resolves.toMatchObject({
			id: 'subscription_created:3001:2026-09-01T10:00:05.000000Z',
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

	test('Refuses a signed body whose resource has no attributes as not an event', async () => {
		const { driver } = setup([]);

		// Refused as a 400 rather than crashing into a 500 that Lemon Squeezy would retry forever.
		const bare = '{"meta":{"event_name":"subscription_created"},"data":{"id":"1"}}';

		await expect(driver.parseWebhook(bare, { 'x-signature': sign(bare) })).rejects.toBeInstanceOf(InvalidPayloadError);

		const nulled = '{"meta":{"event_name":"subscription_created"},"data":{"id":"1","attributes":null}}';

		await expect(driver.parseWebhook(nulled, { 'x-signature': sign(nulled) })).rejects.toBeInstanceOf(
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

	test('Makes any other request through call(), from the API root with the key', async () => {
		const { driver, calls } = setup([{ body: { data: [{ id: '1' }] } }]);

		// The client's own tests cover the request in full.
		await expect(driver.call('GET /v1/discounts', { 'filter[store_id]': 12345 })).resolves.toStrictEqual({
			status: 200,
			headers: {},
			data: { data: [{ id: '1' }] },
		});

		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://api.lemonsqueezy.com/v1/discounts?filter%5Bstore_id%5D=12345',
			headers: { authorization: 'Bearer lemon-key' },
		});
	});
});
