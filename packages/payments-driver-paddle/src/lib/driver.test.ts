/**
 * Tests of the Paddle driver class: the resources stubbed on a real client, the webhooks signed the way Paddle signs
 * them (`ts=…;h1=<hmac>`) and read from fixtures in the shape of Paddle's notification payloads. The mappings are
 * tested in `to-subscription.test.ts`, `to-invoice.test.ts`, `to-event.test.ts` and `to-metadata.test.ts`.
 */
import { createHmac } from 'node:crypto';
import {
	HitRateLimitError,
	InvalidCredentialsError,
	InvalidPayloadError,
	ProviderCallError,
} from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { Environment, Paddle, Subscription, Transaction } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fixtureText } from '../fixtures/index.js';
import { PaymentsDriverPaddle, PRORATION } from './driver.js';

/** The secret the fixtures are signed with. */
const WEBHOOK_SECRET = 'pdl_ntfset_test_secret';

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
 * @param checkoutUrl - The app's checkout page to register on the driver; none unless given.
 * @returns The driver and the client to stub on.
 */
const setup = (checkoutUrl?: string) => {
	// 1. A real client, so the webhook helpers run for real while the resources are spied on per test
	const client = new Paddle('pdl_sdbx_apikey_x', { environment: Environment.sandbox });

	// 2. The option is left out rather than set to `undefined`, the way a location config would leave it out
	const driver = new PaymentsDriverPaddle({
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
	// 1. The notification's data is the API's shape minus the fields only a retrieval carries
	const { data } = JSON.parse(fixtureText(name)) as { data: ConstructorParameters<typeof Subscription>[0] };

	// 2. Those fields are nulled explicitly, so the entity's constructor reads a complete API response
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

describe('PaymentsDriverPaddle', () => {
	test('Refuses to start without a key or a webhook secret', () => {
		// 1. Each missing value is named, so a misconfigured location points at the option to set
		expect(() => new PaymentsDriverPaddle({ apiKey: '', webhookSecret: 's' })).toThrow('"apiKey"');
		expect(() => new PaymentsDriverPaddle({ apiKey: 'k', webhookSecret: '' })).toThrow('"webhookSecret"');
	});

	test('Creates a customer with the organization in its custom data', async () => {
		const { client, driver } = setup();

		// 1. Paddle answers custom data as JSON, a number among it, to prove the metadata comes back as strings
		const create = vi.spyOn(client.customers, 'create').mockResolvedValue({
			id: 'ctm_1',
			email: 'ada@example.com',
			name: 'Ada',
			customData: { organizationId: 'org_42', seats: 3 },
		} as never);

		// 2. The answer is the kit's customer shape, the custom data flattened
		await expect(
			driver.createCustomer({ email: 'ada@example.com', name: 'Ada', metadata: { organizationId: 'org_42' } }),
		).resolves.toStrictEqual({
			id: 'ctm_1',
			email: 'ada@example.com',
			name: 'Ada',
			metadata: { organizationId: 'org_42', seats: '3' },
		});

		// 3. The metadata is sent as custom data; no other field is invented
		expect(create).toHaveBeenCalledWith({
			email: 'ada@example.com',
			name: 'Ada',
			customData: { organizationId: 'org_42' },
		});
	});

	test('Starts a checkout as a transaction whose payment link opens on the checkout page', async () => {
		const { client, driver } = setup('https://app.example.com/checkout');

		// 1. Paddle answers the transaction with the payment link built from the configured page
		const create = vi.spyOn(client.transactions, 'create').mockResolvedValue({
			id: 'txn_1',
			checkout: { url: 'https://app.example.com/checkout?_ptxn=txn_1' },
		} as never);

		// 2. The session is the transaction and its link; a transaction never expires, so no expiry is invented
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

		// 3. The redirects have no counterpart on Paddle and are not sent; the page and the metadata are
		expect(create).toHaveBeenCalledWith({
			items: [{ priceId: 'pri_pro', quantity: 3 }],
			customerId: 'ctm_1',
			customData: { organizationId: 'org_42', planId: 'pro', period: 'monthly' },
			checkout: { url: 'https://app.example.com/checkout' },
		});
	});

	test('Leaves the checkout page to the default payment link and refuses a transaction without a link', async () => {
		const { client, driver } = setup();

		// 1. An account without a default payment link answers no checkout URL at all
		const create = vi.spyOn(client.transactions, 'create').mockResolvedValue({ id: 'txn_2', checkout: null } as never);

		// 2. Nowhere to send the browser is refused by naming the option that fixes it
		await expect(
			driver.createCheckoutSession({ customerId: 'ctm_1', priceId: 'pri_pro', successUrl: 'a', cancelUrl: 'b' }),
		).rejects.toThrow('"checkoutUrl"');

		// 3. Without a configured page no `checkout` is sent, so Paddle falls back to the account's default
		expect(create).toHaveBeenCalledWith({ items: [{ priceId: 'pri_pro', quantity: 1 }], customerId: 'ctm_1' });
	});

	test('Opens the customer portal', async () => {
		const { client, driver } = setup();

		// 1. The portal session carries several links; the overview is the one that covers every subscription
		const create = vi
			.spyOn(client.customerPortalSessions, 'create')
			.mockResolvedValue({ urls: { general: { overview: 'https://customer-portal.paddle.com/x' } } } as never);

		await expect(driver.createPortalSession({ customerId: 'ctm_1', returnUrl: 'https://app' })).resolves.toStrictEqual({
			url: 'https://customer-portal.paddle.com/x',
		});

		// 2. No subscription ids are passed, so the session is not narrowed to one subscription
		expect(create).toHaveBeenCalledWith('ctm_1', []);
	});

	test('Reads a subscription', async () => {
		const { client, driver } = setup();

		// 1. The API entity built from the fixture goes through the same mapping as a webhook's
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

		// 1. The current item is read before the update, so the part not given keeps its value
		vi.spyOn(client.subscriptions, 'get').mockResolvedValue(apiSubscription('subscription.created'));
		const update = vi.spyOn(client.subscriptions, 'update').mockResolvedValue(apiSubscription('subscription.created'));

		// 2. A price change keeps the fixture's quantity of 3 and maps the kit's proration onto Paddle's mode
		await driver.updateSubscription({ subscriptionId: 'sub_1', priceId: 'pri_business', proration: 'invoice' });

		expect(update).toHaveBeenCalledWith('sub_1', {
			items: [{ priceId: 'pri_business', quantity: 3 }],
			prorationBillingMode: PRORATION.invoice,
		});

		// 3. A seat change keeps the current price, and the proration defaults to the next bill
		await driver.updateSubscription({ subscriptionId: 'sub_1', quantity: 5 });

		expect(update).toHaveBeenLastCalledWith('sub_1', {
			items: [{ priceId: 'pri_01gsz8x8sawmvhz1pv30nge1ke', quantity: 5 }],
			prorationBillingMode: PRORATION.prorate,
		});

		// 4. Neither a price nor a quantity is a caller's mistake, refused before any request is sent
		await expect(driver.updateSubscription({ subscriptionId: 'sub_1' })).rejects.toThrow('Nothing to update');
	});

	test('Cancels at the end of the period or right away', async () => {
		const { client, driver } = setup();

		// 1. The updated fixture carries a scheduled cancellation, which is what Paddle answers to a period-end cancel
		const cancel = vi.spyOn(client.subscriptions, 'cancel').mockResolvedValue(apiSubscription('subscription.updated'));

		// 2. The default is the end of the period; the reason has no counterpart on Paddle and is not sent
		await expect(driver.cancelSubscription({ subscriptionId: 'sub_1', reason: 'too pricey' })).resolves.toMatchObject({
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000Z'),
		});

		expect(cancel).toHaveBeenCalledWith('sub_1', { effectiveFrom: 'next_billing_period' });

		// 3. `immediately` is the only other effective date Paddle knows
		await driver.cancelSubscription({ subscriptionId: 'sub_1', immediately: true });
		expect(cancel).toHaveBeenLastCalledWith('sub_1', { effectiveFrom: 'immediately' });
	});

	test('Lists the billed transactions of a customer as invoices', async () => {
		const { client, driver } = setup();

		// 1. The API entity built from the fixture, as the collection's page would carry it
		const { data } = JSON.parse(fixtureText('transaction.completed')) as {
			data: ConstructorParameters<typeof Transaction>[0];
		};

		// 2. `list()` answers a collection; only its first page is read, so only `next()` needs to exist
		const list = vi.spyOn(client.transactions, 'list').mockReturnValue({
			next: async () => [new Transaction(data)],
		} as never);

		const invoices = await driver.listInvoices({ customerId: 'ctm_1', limit: 5 });

		// 3. Only the billed states are asked for, most recent first, one page of the requested size
		expect(list).toHaveBeenCalledWith({
			customerId: ['ctm_1'],
			status: ['billed', 'paid', 'completed', 'past_due', 'canceled'],
			orderBy: 'created_at[DESC]',
			perPage: 5,
		});

		// 4. The page's transactions come back as invoices
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({ id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t', status: 'paid', number: '325-10001' });
	});

	test('Verifies a webhook and refuses a bad or missing signature', async () => {
		const { driver } = setup();
		const body = fixtureText('subscription.created');

		// 1. A body signed with the right secret is verified for real and mapped to the kit's event
		const event = await driver.parseWebhook(body, { 'paddle-signature': sign(body) });

		expect(event).toMatchObject({
			type: 'subscription.created',
			provider: 'paddle',
			id: 'evt_01h7zcgmdc8n1v3ypn6pkqtb5a',
		});

		// 2. No header is a malformed delivery (400), not a forged one
		await expect(driver.parseWebhook(body, {})).rejects.toBeInstanceOf(InvalidPayloadError);

		// 3. A wrong secret is a refused signature (401)
		await expect(driver.parseWebhook(body, { 'paddle-signature': sign(body, 'other') })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		// 4. A header without its timestamp or digest is malformed (400), not a forged signature
		await expect(driver.parseWebhook(body, { 'paddle-signature': 'garbage' })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);

		// 5. A signature older than the SDK's tolerance is refused as well
		await expect(
			driver.parseWebhook(body, { 'paddle-signature': sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 60) }),
		).rejects.toBeInstanceOf(InvalidCredentialsError);

		// 6. A verified body that is not an event is the sender's problem
		const junk = '{"hello":1}';

		await expect(driver.parseWebhook(junk, { 'paddle-signature': sign(junk) })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);
	});

	test('Drops a verified event the kit does not act on', async () => {
		const { driver } = setup();
		const body = fixtureText('customer.updated');

		// 1. The signature is checked first; `null` proves the drop happens after verification, not instead of it
		await expect(driver.parseWebhook(body, { 'paddle-signature': sign(body) })).resolves.toBeNull();
	});

	test('Verifies the key with a cheap read', async () => {
		const { client, driver } = setup();

		// 1. The event types list is the read that needs a key and nothing else
		const list = vi.spyOn(client.eventTypes, 'list').mockResolvedValue([] as never);

		await driver.verify();
		expect(list).toHaveBeenCalled();
	});
});

describe('call', () => {
	/**
	 * The stubbed `fetch` a call goes through.
	 */
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		fetchMock.mockReset();
	});

	/**
	 * Make `fetch` answer once.
	 *
	 * @param body - The JSON body; none for an empty answer.
	 * @param status - The HTTP status.
	 * @param headers - The response headers.
	 */
	const answer = (body: unknown, status = 200, headers: Record<string, string> = {}): void => {
		// 1. A real `Response`, so the body is read the way Paddle's is
		fetchMock.mockResolvedValueOnce(
			new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
		);
	};

	/**
	 * The URL and the init of the first request.
	 *
	 * @returns The URL and the init.
	 */
	const request = (): { url: string; init: RequestInit & { headers: Record<string, string> } } => {
		// 1. Read back from the stub, as `fetch(url, init)` was called
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

		return { url, init };
	};

	/**
	 * A driver with a recognisable key, in the given environment.
	 *
	 * @param options - The environment or a stand-in URL.
	 * @returns The driver.
	 */
	const paddle = (options: { environment?: 'sandbox'; apiUrl?: string } = {}) =>
		new PaymentsDriverPaddle({ apiKey: 'pdl_sdbx_apikey_SECRET', webhookSecret: WEBHOOK_SECRET, ...options });

	test('Sends a GET with its query and the bearer key to the environment’s API, and answers the body', async () => {
		answer({ data: [{ id: 'dsc_1' }], meta: {} });

		// 1. The sandbox API, the parameters in the query, undefined ones left out
		const { data } = await paddle({ environment: 'sandbox' }).call('GET /discounts', {
			status: 'active',
			per_page: 10,
			after: undefined,
		});

		expect(data).toStrictEqual({ data: [{ id: 'dsc_1' }], meta: {} });

		expect(request().url).toBe('https://sandbox-api.paddle.com/discounts?status=active&per_page=10');
		expect(request().init.method).toBe('GET');
		expect(request().init.headers['authorization']).toBe('Bearer pdl_sdbx_apikey_SECRET');
		expect(request().init.body).toBeUndefined();
	});

	test('Posts a JSON body to production, with the caller’s headers and timeout', async () => {
		answer(undefined, 204);

		// 1. The body as JSON; an empty answer is `undefined`
		await expect(
			paddle().call(
				'POST /adjustments',
				{ action: 'refund', transaction_id: 'txn_1' },
				{ headers: { 'Paddle-Version': '1' }, timeout: 5_000 },
			),
		).resolves.toStrictEqual({ status: 204, headers: {}, data: undefined });

		expect(request().url).toBe('https://api.paddle.com/adjustments');
		expect(JSON.parse(request().init.body as string)).toStrictEqual({ action: 'refund', transaction_id: 'txn_1' });
		expect(request().init.headers['content-type']).toBe('application/json');
		expect(request().init.headers['paddle-version']).toBe('1');
	});

	test('Reaches a full URL on the other Paddle host and the configured stand-in', async () => {
		answer({ data: [] });
		answer({ data: [] });

		// 1. The sandbox host from a production driver; a path under a stand-in's root
		await paddle().call('GET https://sandbox-api.paddle.com/prices');
		await paddle({ apiUrl: 'http://localhost:4010' }).call('GET /prices');

		expect(fetchMock.mock.calls.map(([url]) => url)).toStrictEqual([
			'https://sandbox-api.paddle.com/prices',
			'http://localhost:4010/prices',
		]);
	});

	test('Refuses a URL on another host before any request', async () => {
		// 1. The key would travel with it
		await expect(paddle().call('GET https://evil.example/prices')).rejects.toThrow('evil.example');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Turns an error status into ProviderCallError with Paddle’s answer, and never names the key', async () => {
		const body = { error: { type: 'request_error', code: 'not_found', detail: 'Entity not found' } };

		answer(body, 404);

		// 1. The status and the answer in the extensions; the key neither in the message nor in them
		const error = (await paddle()
			.call('GET /discounts/dsc_404')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.extensions).toStrictEqual({ provider: 'paddle', method: 'GET /discounts/dsc_404', status: 404, body });
		expect(error.message).not.toContain('SECRET');
		expect(JSON.stringify(error.extensions)).not.toContain('SECRET');
	});

	test('Turns a 429 into HitRateLimitError', async () => {
		answer({ error: { code: 'too_many_requests' } }, 429, { 'retry-after': '3' });

		// 1. Reset at the Retry-After Paddle names
		const error = (await paddle()
			.call('GET /prices')
			.catch((caught: unknown) => caught)) as InstanceType<typeof HitRateLimitError>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.extensions.reset.getTime()).toBeGreaterThan(Date.now() + 2_000);
	});

	test('Gives up with TimeoutError and aborts the request', async () => {
		// 1. A request that only ends when its signal aborts
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(paddle().call('GET /prices', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
		expect(request().init.signal?.aborted).toBe(true);
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		answer({ data: { id: 'ctm_1' } }, 200, { 'X-Request-Id': 'req_1' });

		// 1. Paddle's request id readable under its lower-case name
		await expect(paddle().call('GET /customers/ctm_1')).resolves.toStrictEqual({
			status: 200,
			headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-request-id': 'req_1' },
			data: { data: { id: 'ctm_1' } },
		});
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		answer({ data: {} });
		answer({ data: {} });

		// 1. In a GET, the id leaves the query
		await paddle().call('GET /customers/{id}', { id: 'ctm 1/x', include: 'addresses' });

		expect(request().url).toBe('https://api.paddle.com/customers/ctm%201%2Fx?include=addresses');

		// 2. In a PATCH, it leaves the body
		await paddle().call('PATCH /customers/{id}', { id: 'ctm_1', name: 'Ada' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://api.paddle.com/customers/ctm_1');
		expect(JSON.parse(init.body as string)).toStrictEqual({ name: 'Ada' });
	});

	test('Refuses a {name} no parameter fills before any request', async () => {
		// 1. Sent, it would reach Paddle as `%7Bid%7D`
		await expect(paddle().call('GET /customers/{id}', { name: 'Ada' })).rejects.toThrow('{id}');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
