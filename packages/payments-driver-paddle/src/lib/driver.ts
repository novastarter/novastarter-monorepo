import { InvalidConfigError, InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import type {
	CancelSubscriptionInput,
	CheckoutSession,
	CreateCheckoutSessionInput,
	CreateCustomerInput,
	CreatePortalSessionInput,
	Invoice,
	ListInvoicesInput,
	PaymentsCustomer,
	PaymentsDriver,
	PaymentsEvent,
	PortalSession,
	Subscription,
	UpdateSubscriptionInput,
	WebhookHeaders,
} from '@novastarter/payments';
import { toErrorMessage } from '@novastarter/utils';
import { Environment, Paddle, type ProrationBillingMode } from '@paddle/paddle-node-sdk';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';
import { signaturePartsOf, verifySignature } from './verify-signature.js';

/**
 * Options of {@link PaymentsDriverPaddle}, as given in the location's `options`.
 */
export type PaymentsDriverPaddleConfig = {
	/** API key from Paddle → Developer tools → Authentication (`pdl_live_apikey_…` / `pdl_sdbx_apikey_…`). */
	apiKey: string;
	/** Secret key of the notification destination (`pdl_ntfset_…`), from Developer tools → Notifications. */
	webhookSecret: string;
	/** `sandbox` for the sandbox account; `production` unless given. */
	environment?: 'production' | 'sandbox' | undefined;
	/** Another base URL of the API, overriding the environment — a stand-in for tests. */
	apiUrl?: string | undefined;
	/**
	 * The page of the app that opens Paddle Checkout (Paddle.js) — an approved domain; Paddle appends
	 * `?_ptxn=<transaction id>` to it. The account's default payment link unless given.
	 */
	checkoutUrl?: string | undefined;
	/**
	 * A client to use instead of one built from the key — tests hand in one with stubbed resources.
	 *
	 * @internal
	 */
	client?: Paddle | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/payments`, so a location naming `paddle` has its
 * options checked against {@link PaymentsDriverPaddleConfig}.
 */
declare module '@novastarter/payments' {
	interface PaymentsDrivers {
		paddle: PaymentsDriverPaddleConfig;
	}
}

/**
 * The header a Paddle webhook signs with: `ts=<unix seconds>;h1=<hex hmac-sha256 of "ts:body">`.
 *
 * @defaultValue `paddle-signature`
 */
export const SIGNATURE_HEADER = 'paddle-signature';

/**
 * The largest page Paddle's list endpoints answer; a larger `per_page` is capped to it.
 *
 * @defaultValue 30
 * @internal
 */
const PADDLE_MAX_PER_PAGE = 30;

/**
 * How the kit's proration choice maps onto Paddle's `proration_billing_mode`: `prorate` charges the difference on
 * the next bill, `invoice` right away, `none` never.
 *
 * @defaultValue `prorate` → `prorated_next_billing_period`, `none` → `do_not_bill`, `invoice` → `prorated_immediately`
 */
export const PRORATION: Record<NonNullable<UpdateSubscriptionInput['proration']>, ProrationBillingMode> = {
	prorate: 'prorated_next_billing_period',
	none: 'do_not_bill',
	invoice: 'prorated_immediately',
};

/**
 * The root of Paddle's API for each environment, which {@link PaymentsDriverPaddle.call} joins its paths to.
 *
 * @defaultValue `production` → `https://api.paddle.com`, `sandbox` → `https://sandbox-api.paddle.com`
 */
export const PADDLE_API_URLS: Readonly<Record<'production' | 'sandbox', string>> = {
	production: 'https://api.paddle.com',
	sandbox: 'https://sandbox-api.paddle.com',
};

/**
 * The hosts a full URL given to {@link PaymentsDriverPaddle.call} may point at, besides the configured API's own.
 *
 * @defaultValue `api.paddle.com`, `sandbox-api.paddle.com`
 * @internal
 */
export const PADDLE_CALL_HOSTS: readonly string[] = ['api.paddle.com', 'sandbox-api.paddle.com'];

/**
 * Driver for [Paddle Billing](https://www.paddle.com) (API v2): transactions as the checkout and the invoices, the
 * customer portal, subscriptions over `@paddle/paddle-node-sdk`, webhooks verified with the destination's secret.
 *
 * Paddle is a merchant of record that bills prices (the catalog's `providerIds.paddle` are price ids, `pri_…`).
 * Its checkout is Paddle.js on a page of the app: a checkout session here is a transaction whose `checkout.url`
 * is that page with the transaction id, and the success redirect is Paddle.js's (`checkout.settings.successUrl`),
 * so `successUrl` / `cancelUrl` of the input have no counterpart. Trials and discount codes are set on the price
 * and the checkout in Paddle rather than per session.
 *
 * Webhook verification follows the SDK's five-second replay window and accepts timestamps ahead of the clock, so a
 * server clock running more than five seconds behind Paddle's rejects valid deliveries — keep the clock in sync.
 *
 * @example
 * ```ts
 * import { usePayments } from '@novastarter/payments';
 * import { PaymentsDriverPaddle } from '@novastarter/payments-driver-paddle';
 * import { env } from './env';
 *
 * const payments = usePayments();
 *
 * payments.registerDriver('paddle', PaymentsDriverPaddle);
 * payments.registerLocation('default', {
 * 	driver: 'paddle',
 * 	options: {
 * 		apiKey: env.PAYMENTS_PADDLE_API_KEY,
 * 		webhookSecret: env.PAYMENTS_PADDLE_WEBHOOK_SECRET,
 * 		environment: 'sandbox',
 * 		checkoutUrl: 'https://app.example.com/checkout',
 * 	},
 * });
 * ```
 */
export class PaymentsDriverPaddle implements PaymentsDriver {
	/**
	 * The `@paddle/paddle-node-sdk` client every request goes through.
	 *
	 * @internal
	 */
	private readonly client: Paddle;

	/**
	 * The notification destination's secret, checked on every delivery.
	 *
	 * @internal
	 */
	private readonly webhookSecret: string;

	/**
	 * The app's page that opens Paddle Checkout; the account's default payment link when unset.
	 *
	 * @internal
	 */
	private readonly checkoutUrl: string | undefined;

	/**
	 * Paddle's API as a {@link call} reaches it: the environment's root or the configured stand-in, Paddle's hosts,
	 * the key as the bearer token — the SDK keeps its own copy private.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver from its location options.
	 *
	 * @param config - API key, webhook secret, environment, checkout page.
	 * @throws InvalidConfigError without a key or a webhook secret — a deployment that cannot verify webhooks would
	 * drift from Paddle silently.
	 */
	constructor(config: PaymentsDriverPaddleConfig) {
		// Fail at registration for the two values nothing works without, rather than on the first request
		if (!config.apiKey) {
			throw new InvalidConfigError({ reason: 'The paddle payments driver needs an "apiKey"' });
		}

		if (!config.webhookSecret) {
			throw new InvalidConfigError({ reason: 'The paddle payments driver needs a "webhookSecret"' });
		}

		// The SDK takes a base URL in place of an environment name, which is how a stand-in is reached; the option
		// is typed as the SDK's string enum, so an arbitrary URL reaches it through `unknown` — a plain
		// `as Environment` would assert the URL is a member of the enum
		const environment = config.environment === 'sandbox' ? Environment.sandbox : Environment.production;

		this.client =
			config.client ??
			new Paddle(config.apiKey, { environment: (config.apiUrl ?? environment) as unknown as Environment });

		this.webhookSecret = config.webhookSecret;
		this.checkoutUrl = config.checkoutUrl;

		// The SDK has no raw request, so `call()` makes its own with the same key against the same API
		this.api = {
			provider: 'paddle',
			baseUrl: config.apiUrl ?? PADDLE_API_URLS[config.environment === 'sandbox' ? 'sandbox' : 'production'],
			hosts: PADDLE_CALL_HOSTS,
			headers: { authorization: `Bearer ${config.apiKey}` },
		};
	}

	/**
	 * Create the Paddle customer for an organization.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 * @throws Paddle's `ApiError` when the request is refused, or the fetch error when Paddle cannot be reached.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		const customer = await this.client.customers.create({
			email: input.email,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.metadata !== undefined ? { customData: input.metadata } : {}),
		});

		// Custom data comes back as JSON; the kit's metadata is flat strings
		return { id: customer.id, email: customer.email, name: customer.name, metadata: toMetadata(customer.customData) };
	}

	/**
	 * Start a checkout: a transaction for the price, whose payment link opens Paddle Checkout on the app's page.
	 *
	 * The metadata goes on the transaction as custom data; Paddle copies it onto the subscription it creates.
	 *
	 * @param input - Customer, price, seats, metadata (the redirects and the trial are Paddle's, see the class).
	 * @returns The transaction and its payment link.
	 * @throws Paddle's `ApiError` when the request is refused — an unknown price or customer — or the fetch error
	 * when Paddle cannot be reached.
	 * @throws InvalidConfigError when Paddle hands back no payment link — the account has no default payment link and
	 * the location names no checkout page.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// The checkout page is the configured one or Paddle's default payment link
		const transaction = await this.client.transactions.create({
			items: [{ priceId: input.priceId, quantity: input.quantity ?? 1 }],
			customerId: input.customerId,
			...(input.metadata !== undefined ? { customData: input.metadata } : {}),
			...(this.checkoutUrl !== undefined ? { checkout: { url: this.checkoutUrl } } : {}),
		});

		// Without a payment link there is nowhere to send the browser; Paddle only fills it when a page is known
		if (!transaction.checkout?.url) {
			throw new InvalidConfigError({
				reason: `Paddle transaction "${transaction.id}" has no checkout URL: set the "checkoutUrl" option or a default payment link in Paddle`,
			});
		}

		// A transaction does not expire the way a hosted session does
		return { id: transaction.id, url: transaction.checkout.url, expiresAt: null };
	}

	/**
	 * Open the customer portal through a portal session.
	 *
	 * @param input - Customer (the return URL is the portal's own "back" link, configured in Paddle).
	 * @returns The portal page.
	 * @throws Paddle's `ApiError` when there is no such customer, or the fetch error when Paddle cannot be reached.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// Without subscription ids, the overview link covers every subscription of the customer
		const session = await this.client.customerPortalSessions.create(input.customerId, []);

		return { url: session.urls.general.overview };
	}

	/**
	 * Read a subscription.
	 *
	 * @param subscriptionId - Paddle's id.
	 * @returns The subscription, normalised.
	 * @throws Paddle's `ApiError` when there is no such subscription, or the fetch error when Paddle cannot be
	 * reached.
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// The entity carries the items with their prices, which is all the mapping reads
		return toSubscription(await this.client.subscriptions.get(subscriptionId));
	}

	/**
	 * Change the price (plan) and/or the seat count.
	 *
	 * Paddle takes the full list of items on an update, so the current items are read first: the first one is
	 * rewritten with the new price and/or quantity, every other one is sent back unchanged so Paddle keeps it.
	 *
	 * @param input - Subscription, new price and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws InvalidPayloadError when neither a price nor a seat count is given.
	 * @throws Paddle's `ApiError` when the request is refused — no such subscription, an unknown price, a quantity
	 * outside the price's limits — or the fetch error when Paddle cannot be reached.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		// An update with nothing to change is a caller's mistake, not a request to send
		if (input.priceId === undefined && input.quantity === undefined) {
			throw new InvalidPayloadError({
				reason: `Nothing to update on Paddle subscription "${input.subscriptionId}": give a priceId or a quantity`,
			});
		}

		// The raw entity keeps every item; the mapped one gives the price and quantity that stay
		const raw = await this.client.subscriptions.get(input.subscriptionId);
		const current = toSubscription(raw);

		// Paddle takes the full item list and removes what is left out, so every other item (an add-on added on the
		// dashboard or through `call()`) is sent back unchanged and only the first one gets the merged price and quantity
		const items = raw.items.map((item, index) =>
			index === 0
				? { priceId: input.priceId ?? current.priceId, quantity: input.quantity ?? current.quantity }
				: { priceId: item.price.id, quantity: item.quantity },
		);

		const updated = await this.client.subscriptions.update(input.subscriptionId, {
			items,
			prorationBillingMode: PRORATION[input.proration ?? 'prorate'],
		});

		return toSubscription(updated);
	}

	/**
	 * Cancel a subscription: at the end of the billing period (a scheduled change), or right away.
	 *
	 * Paddle records no cancellation reason; it is not sent.
	 *
	 * @param input - Subscription, when.
	 * @returns The subscription after the request.
	 * @throws Paddle's `ApiError` when there is no such subscription or it is already canceled, or the fetch error
	 * when Paddle cannot be reached.
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// The effective date is what tells a scheduled cancellation from an immediate one
		const subscription = await this.client.subscriptions.cancel(input.subscriptionId, {
			effectiveFrom: input.immediately ? 'immediately' : 'next_billing_period',
		});

		return toSubscription(subscription);
	}

	/**
	 * The customer's transactions, most recent first, as invoices — the ones that were billed: drafts and
	 * abandoned checkouts are left out.
	 *
	 * @param input - Customer and how many.
	 * @returns The invoices, normalised.
	 * @throws Paddle's `ApiError` when the request is refused, or the fetch error when Paddle cannot be reached.
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		const limit = input.limit ?? 20;

		// A draft or an abandoned checkout is not an invoice. Paddle caps a page at `PADDLE_MAX_PER_PAGE`, so a larger
		// limit is asked for in pages of that size
		const page = this.client.transactions.list({
			customerId: [input.customerId],
			status: ['billed', 'paid', 'completed', 'past_due', 'canceled'],
			orderBy: 'created_at[DESC]',
			perPage: Math.min(limit, PADDLE_MAX_PER_PAGE),
		});

		// Pages are read until the limit is reached or Paddle has no more, so a limit above one page is not cut short
		const transactions: Awaited<ReturnType<typeof page.next>> = [];

		do {
			transactions.push(...(await page.next()));
		} while (transactions.length < limit && page.hasMore);

		// The last page may overshoot the limit
		return transactions.slice(0, limit).map(toInvoice);
	}

	/**
	 * Verify a webhook against the destination's secret and normalise its event.
	 *
	 * The signature is verified in the driver, in constant time, before the SDK's `unmarshal` is asked to parse the
	 * body — the SDK's own digest comparison short-circuits on the first differing byte.
	 *
	 * @param rawBody - The body byte for byte.
	 * @param headers - The request headers, lower-cased.
	 * @returns The event, or `null` for one the kit does not act on.
	 * @throws InvalidPayloadError without the `paddle-signature` header, for a header without its timestamp or
	 * digest, or for a body that is not a Paddle event.
	 * @throws InvalidCredentialsError when the signature does not verify, or its timestamp is outside the SDK's
	 * tolerance.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// Without a signature header there is nothing to verify against; the delivery is malformed, not forged
		const signature = headers[SIGNATURE_HEADER];

		if (!signature) {
			throw new InvalidPayloadError({ reason: `The delivery carries no ${SIGNATURE_HEADER} header` });
		}

		// The header must name the timestamp and the digest; one without them is malformed (400), not forged
		const parts = signaturePartsOf(signature);

		// The HMAC is recomputed and compared in constant time before the SDK sees the body, the SDK's signed
		// payload and replay window reproduced exactly — its own comparison would leak how much of a guessed
		// signature was right
		if (!verifySignature(rawBody, parts, this.webhookSecret)) {
			throw new InvalidCredentialsError();
		}

		// The signature is verified; `unmarshal` now only parses the body — its own verification runs again inside
		// as a formality, so a failure there is no longer expected
		let event;

		try {
			event = await this.client.webhooks.unmarshal(rawBody, this.webhookSecret, signature);
		} catch (error) {
			// An SDK signature error here can only be the replay window closing between the two checks — still a
			// credentials problem, not a payload one; anything else it throws is a payload problem
			if (toErrorMessage(error).startsWith('[Paddle]')) {
				throw new InvalidCredentialsError(undefined, { cause: error });
			}

			throw new InvalidPayloadError({ reason: toErrorMessage(error) });
		}

		// A verified body that is not an event is the sender's problem, reported as such — the SDK reads an unknown
		// type as a generic event and a non-event as one without a type or an id
		if (typeof event.eventType !== 'string' || typeof event.eventId !== 'string') {
			throw new InvalidPayloadError({ reason: 'The body is not a Paddle event' });
		}

		return toEvent(event);
	}

	/**
	 * Make a request of any Paddle endpoint with the location's API key, for what the SDK or the contract does not
	 * cover.
	 *
	 * `method` is the verb and the path from the API's root — `GET /discounts` — or a full URL on one of
	 * {@link PADDLE_CALL_HOSTS}. The parameters of a `GET` or `DELETE` go in the query (Paddle reads a list as one
	 * comma-separated value: `status: 'active,paused'`), the others as a JSON body. A `{name}` in the path is filled
	 * from the parameter of that name, URL-encoded, and that parameter is not sent again.
	 *
	 * @typeParam T - What the endpoint answers with — Paddle's `{ data, meta }`; the caller knows it from Paddle's API
	 * reference.
	 * @param method - The verb and the path, or a full URL on Paddle's hosts.
	 * @param params - The placeholders' values, and the query of a `GET` or `DELETE` or the JSON body otherwise.
	 * @param options - A timeout over the default 30 seconds, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and Paddle's answer, parsed; `undefined` for an empty one.
	 * @throws ProviderCallError when Paddle answers with an error status — its status and `{ error }` in `extensions`.
	 * @throws HitRateLimitError when Paddle answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, or its URL is not
	 * on Paddle's hosts.
	 * @example
	 * ```ts
	 * const { data } = await paddle.call('GET /discounts', { status: 'active', per_page: 50 });
	 * const { headers } = await paddle.call('GET /customers/{id}', { id: 'ctm_123' });
	 * await paddle.call('POST /adjustments', {
	 * 	action: 'refund',
	 * 	transaction_id: 'txn_123',
	 * 	reason: 'Charged twice',
	 * 	type: 'full',
	 * });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// The shared request does it all: placeholders, Paddle's hosts only — so the key never travels elsewhere —
		// the deadline, and an error status turned into the kit's error with Paddle's `{ error }`
		return request<T>(this.api, method, params, options);
	}

	/**
	 * Prove the key works with the cheapest read there is.
	 *
	 * @throws Paddle's `ApiError` when it does not.
	 */
	async verify(): Promise<void> {
		// The event types need nothing but a valid key and answer the same for every account
		await this.client.eventTypes.list();
	}
}
