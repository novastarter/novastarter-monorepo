import { InvalidCredentialsError, InvalidPayloadError, toProviderCallError } from '@novastarter/errors';
import {
	type CallOptions,
	type CallResponse,
	DEFAULT_REQUEST_TIMEOUT,
	type HeadersLike,
	parseCallMethod,
	toHeaderRecord,
} from '@novastarter/http';
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
import { withTimeout } from '@novastarter/utils';
import Stripe from 'stripe';
import { fromUnix } from './from-unix.js';
import { idOf } from './id-of.js';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toSubscription } from './to-subscription.js';

/**
 * Options of {@link PaymentsDriverStripe}, as given in the location's `options`.
 */
export type PaymentsDriverStripeConfig = {
	/** Secret key from the Stripe dashboard (`sk_live_…`, `sk_test_…`). */
	secretKey: string;
	/** Signing secret of the webhook endpoint (`whsec_…`), from the dashboard or `stripe listen`. */
	webhookSecret: string;
	/** Seconds a webhook's timestamp may be off before it is refused; Stripe's default of 300 unless given. */
	webhookTolerance?: number | undefined;
	/** What Stripe's request logs show for this integration (name, version, url); nothing unless given. */
	appInfo?: Stripe.AppInfo | undefined;
	/**
	 * A client to use instead of one built from the key — tests hand in one with stubbed resources.
	 *
	 * @internal
	 */
	client?: Stripe | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/payments`, so a location naming `stripe` has its
 * options checked against {@link PaymentsDriverStripeConfig}.
 */
declare module '@novastarter/payments' {
	interface PaymentsDrivers {
		stripe: PaymentsDriverStripeConfig;
	}
}

/**
 * The header Stripe signs its webhooks with.
 *
 * @defaultValue `stripe-signature`
 */
export const SIGNATURE_HEADER = 'stripe-signature';

/**
 * How the kit's proration choice maps onto Stripe's `proration_behavior`.
 *
 * @defaultValue `prorate` → `create_prorations`, `none` → `none`, `invoice` → `always_invoice`
 */
export const PRORATION: Record<
	NonNullable<UpdateSubscriptionInput['proration']>,
	Stripe.SubscriptionUpdateParams.ProrationBehavior
> = {
	prorate: 'create_prorations',
	none: 'none',
	invoice: 'always_invoice',
};

/**
 * The hosts a full URL given to {@link PaymentsDriverStripe.call} may point at, each with the `apiBase` the SDK
 * resolves it by — so the request still goes through the client, its key and its API version.
 *
 * @defaultValue `api.stripe.com`, `files.stripe.com`, `connect.stripe.com`, `meter-events.stripe.com`
 * @internal
 */
export const STRIPE_CALL_HOSTS: Readonly<Record<string, NonNullable<Stripe.RawRequestOptions['apiBase']>>> = {
	'api.stripe.com': 'api',
	'files.stripe.com': 'files',
	'connect.stripe.com': 'connect',
	'meter-events.stripe.com': 'meter_events',
};

/**
 * Driver for [Stripe Billing](https://docs.stripe.com/billing): hosted Checkout, the customer portal, subscriptions
 * and invoices over `stripe-node`, webhooks verified with the endpoint's signing secret.
 *
 * @example
 * ```ts
 * import { usePayments } from '@novastarter/payments';
 * import { PaymentsDriverStripe } from '@novastarter/payments-driver-stripe';
 * import { env } from './env';
 *
 * const payments = usePayments();
 *
 * payments.registerDriver('stripe', PaymentsDriverStripe);
 * payments.registerLocation('default', {
 * 	driver: 'stripe',
 * 	options: {
 * 		secretKey: env.PAYMENTS_STRIPE_SECRET_KEY,
 * 		webhookSecret: env.PAYMENTS_STRIPE_WEBHOOK_SECRET,
 * 	},
 * });
 * ```
 */
export class PaymentsDriverStripe implements PaymentsDriver {
	/**
	 * The `stripe-node` client every request of the driver goes through: the SDK's own API, with the location's secret
	 * key, for everything the contract and {@link call} do not cover — an upload through `files.create`, a typed
	 * resource, auto-pagination.
	 *
	 * @example
	 * ```ts
	 * const stripe = usePayments().location('stripe') as PaymentsDriverStripe;
	 *
	 * const file = await stripe.client.files.create({
	 * 	purpose: 'dispute_evidence',
	 * 	file: { data: pdf, name: 'receipt.pdf', type: 'application/pdf' },
	 * });
	 * ```
	 */
	readonly client: Stripe;

	/**
	 * The signing secret of the webhook endpoint, checked on every delivery.
	 *
	 * @internal
	 */
	private readonly webhookSecret: string;

	/**
	 * Seconds a webhook's timestamp may be off; the SDK's default when unset.
	 *
	 * @internal
	 */
	private readonly webhookTolerance: number | undefined;

	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Secret key and webhook secret.
	 * @throws Error without either — a deployment that cannot verify webhooks would drift from Stripe silently.
	 */
	constructor(config: PaymentsDriverStripeConfig) {
		// 1. Fail at registration for the two values nothing works without, rather than on the first request
		if (!config.secretKey) {
			throw new Error('The stripe payments driver needs a "secretKey"');
		}

		if (!config.webhookSecret) {
			throw new Error('The stripe payments driver needs a "webhookSecret"');
		}

		// 2. The SDK pins the API version it was built for; the application's `appInfo`, when given, shows up in
		//    Stripe's request logs
		this.client =
			config.client ??
			new Stripe(config.secretKey, { ...(config.appInfo !== undefined ? { appInfo: config.appInfo } : {}) });

		this.webhookSecret = config.webhookSecret;
		this.webhookTolerance = config.webhookTolerance;
	}

	/**
	 * Create the Stripe customer for an organization.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 * @throws Stripe's `StripeError` when the request is refused or Stripe cannot be reached.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		// 1. Optional fields are only sent when given, so Stripe keeps its defaults otherwise
		const customer = await this.client.customers.create({
			email: input.email,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});

		// 2. Stripe may answer without an email for a customer made by another channel; the input's stands in
		return {
			id: customer.id,
			email: customer.email ?? input.email,
			name: customer.name ?? null,
			metadata: customer.metadata ?? {},
		};
	}

	/**
	 * Start a hosted Checkout session in subscription mode.
	 *
	 * The metadata goes both on the session and on the subscription it creates (`subscription_data.metadata`), so
	 * `checkout.session.completed` and `customer.subscription.created` alike carry the plan and organization ids.
	 *
	 * @param input - Customer, price, seats, redirects, trial, metadata.
	 * @returns The session and its page.
	 * @throws Stripe's `StripeError` when the request is refused — an unknown price or customer — or Stripe cannot be
	 * reached.
	 * @throws Error when Stripe answers a session without a URL — a session made for an embedded UI, not a redirect.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// 1. Subscription mode with one line item: the plan's price, times its seats
		const session = await this.client.checkout.sessions.create({
			mode: 'subscription',
			customer: input.customerId,
			line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			...(input.allowPromotionCodes !== undefined ? { allow_promotion_codes: input.allowPromotionCodes } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
			subscription_data: {
				...(input.trialDays !== undefined && input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
				...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
			},
		});

		// 2. A session without a URL cannot be redirected to; the kit only does hosted checkouts
		if (!session.url) {
			throw new Error(`Stripe checkout session "${session.id}" has no URL to redirect to`);
		}

		return { id: session.id, url: session.url, expiresAt: fromUnix(session.expires_at) };
	}

	/**
	 * Open the customer portal.
	 *
	 * @param input - Customer and return URL.
	 * @returns The portal page.
	 * @throws Stripe's `StripeError` when the request is refused — an unknown customer — or Stripe cannot be reached.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// 1. A portal session is short-lived; the URL is all the caller needs
		const session = await this.client.billingPortal.sessions.create({
			customer: input.customerId,
			return_url: input.returnUrl,
		});

		return { url: session.url };
	}

	/**
	 * Read a subscription.
	 *
	 * @param subscriptionId - Stripe's id.
	 * @returns The subscription, normalised.
	 * @throws Stripe's `StripeError` when there is no such subscription or Stripe cannot be reached.
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// 1. The default expansion carries the items with their prices, which is all the mapping reads
		return toSubscription(await this.client.subscriptions.retrieve(subscriptionId));
	}

	/**
	 * Change the price or the seat count of the subscription's item.
	 *
	 * Stripe changes are made on the item, so the subscription is read first for its item id; the same call carries
	 * the new price and quantity, and Stripe prorates as told. A change that needs an immediate payment — a `proration`
	 * of `invoice` — applies only once that payment succeeds. When it fails, Stripe keeps the old item and holds the
	 * change in its `pending_update`, which the normalised subscription cannot show, so the call throws instead of
	 * answering the unchanged subscription. The pending change still applies if the invoice is paid before Stripe
	 * drops it (after 23 hours).
	 *
	 * @param input - Subscription, new price and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws Error when neither a price nor a seat count is given.
	 * @throws Error when the change's payment failed and the change waits in Stripe's `pending_update`.
	 * @throws Stripe's `StripeError` when the request is refused — no such subscription, an unknown price — or Stripe
	 * cannot be reached.
	 * @throws Error for a subscription without items.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		// 1. An update with nothing to change is a caller's mistake, not a request to send
		if (input.priceId === undefined && input.quantity === undefined) {
			throw new Error(
				`Nothing to update on Stripe subscription "${input.subscriptionId}": give a priceId or a quantity`,
			);
		}

		// 2. The item is what carries price and quantity; there is one per subscription in the kit's model
		const current = await this.client.subscriptions.retrieve(input.subscriptionId);
		const item = current.items.data[0];

		if (!item) {
			throw new Error(`Stripe subscription "${input.subscriptionId}" has no items`);
		}

		// 3. One update carries both changes; Stripe prorates the way the caller chose, `prorate` unless told. A change
		//    that needs a payment waits in `pending_update` until it is paid, so a declined card never leaves the
		//    subscription on a price nobody paid for
		const updated = await this.client.subscriptions.update(input.subscriptionId, {
			items: [
				{
					id: item.id,
					...(input.priceId !== undefined ? { price: input.priceId } : {}),
					...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
				},
			],
			proration_behavior: PRORATION[input.proration ?? 'prorate'],
			payment_behavior: 'pending_if_incomplete',
		});

		// 4. A pending update means the payment failed and nothing changed; answering the old subscription would read
		//    as success, so the caller is told, with the invoice that would still apply the change once paid
		if (updated.pending_update) {
			const invoiceId = idOf(updated.latest_invoice);

			throw new Error(
				`Stripe subscription "${input.subscriptionId}" was not changed: the payment for the change failed, ` +
					`and the change waits in pending_update until invoice "${invoiceId ?? 'unknown'}" is paid`,
			);
		}

		// 5. Without a pending update the change is applied, and the answer is the subscription after it
		return toSubscription(updated);
	}

	/**
	 * Cancel a subscription: at the end of the period (`cancel_at_period_end`), or right away (`cancel`).
	 *
	 * @param input - Subscription, when, why.
	 * @returns The subscription after the request.
	 * @throws Stripe's `StripeError` when there is no such subscription or Stripe cannot be reached.
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// 1. The reason is recorded on Stripe's side either way, as the cancellation's comment
		const details = input.reason !== undefined ? { cancellation_details: { comment: input.reason } } : {};

		// 2. Right away is a `cancel`; at period end is an update that flags the subscription
		const subscription = input.immediately
			? await this.client.subscriptions.cancel(input.subscriptionId, details)
			: await this.client.subscriptions.update(input.subscriptionId, { cancel_at_period_end: true, ...details });

		return toSubscription(subscription);
	}

	/**
	 * The customer's invoices, most recent first — Stripe's own order.
	 *
	 * @param input - Customer and how many.
	 * @returns The invoices, normalised.
	 * @throws Stripe's `StripeError` when the request is refused or Stripe cannot be reached.
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		// 1. Twenty invoices are asked for unless the caller names a limit: the kit's default across providers, where
		//    leaving it to Stripe would silently page at its own default of ten
		const limit = input.limit ?? 20;

		// 2. Stripe lists most recent first already; the limit is passed on every call
		const invoices = await this.client.invoices.list({
			customer: input.customerId,
			limit,
		});

		return invoices.data.map(toInvoice);
	}

	/**
	 * Verify a webhook against the signing secret and normalise its event.
	 *
	 * @param rawBody - The body byte for byte.
	 * @param headers - The request headers, lower-cased.
	 * @returns The event, or `null` for one the kit does not act on.
	 * @throws InvalidPayloadError without the `stripe-signature` header, or for a body that is not a Stripe event —
	 * not JSON, or JSON without an event's `id`, `type` and `data.object`.
	 * @throws InvalidCredentialsError when the signature does not verify, or the timestamp is outside the tolerance.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// 1. Without a signature header there is nothing to verify against; the delivery is malformed, not forged
		const signature = headers[SIGNATURE_HEADER];

		if (!signature) {
			throw new InvalidPayloadError({ reason: `The delivery carries no ${SIGNATURE_HEADER} header` });
		}

		// 2. The SDK verifies the signature and the timestamp, then parses the body — in that order. It types the result
		//    as an event but checks no shape, so it is held as unknown until the shape is checked here
		let event: unknown;

		try {
			event = await this.client.webhooks.constructEventAsync(
				rawBody,
				signature,
				this.webhookSecret,
				this.webhookTolerance,
			);
		} catch (error) {
			// 3. A signature that does not match, or a stale timestamp, is a credentials problem; anything else is
			//    Stripe failing to read the body
			if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
				throw new InvalidCredentialsError();
			}

			throw new InvalidPayloadError({ reason: error instanceof Error ? error.message : 'Unreadable Stripe event' });
		}

		// 4. A signed body that parses but is not an event is the sender's problem: refused as such, rather than
		//    dropped as an event of no interest, which would acknowledge it and log nothing
		if (!isStripeEvent(event)) {
			throw new InvalidPayloadError({ reason: 'The body is not a Stripe event' });
		}

		// 5. The mapping decides which Stripe events the kit acts on
		return toEvent(event);
	}

	/**
	 * Make a request of any Stripe endpoint with the client's key and API version, through the SDK's `rawRequest`.
	 *
	 * `method` is the verb and the path — `POST /v1/refunds` — or a full URL on one of {@link STRIPE_CALL_HOSTS}, which
	 * picks the SDK's base for that host. A `{name}` in it is filled from the parameter of that name, URL-encoded, and
	 * that parameter is not sent again. The parameters of a `GET` or `DELETE` go in the query, in Stripe's bracket
	 * notation (`expand[0]=…`, `metadata[plan]=…`); those of a `POST` are the body, form-encoded under `/v1` and JSON
	 * under `/v2`, as the SDK sends them. Stripe takes a body on `POST` only. A file is not sent: the SDK's raw request
	 * makes no multipart body, so an upload goes through {@link client} — `client.files.create()`.
	 *
	 * The SDK's network retries are off for this call, so the timeout bounds the work and not only the caller's wait.
	 * A timeout or an abort does not cancel the request on Stripe's side: a `POST` may still have been applied. To retry
	 * one safely, pass your own `Idempotency-Key` in `options.headers` and send the same key again.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Stripe's API reference.
	 * @param method - The verb and the path, or a full URL on Stripe's hosts.
	 * @param params - The placeholders' values, and the query of a `GET` or `DELETE` or the body of a `POST`.
	 * @param options - A timeout over the default 30 seconds, an abort signal, extra headers — an `Idempotency-Key`, a
	 * `Stripe-Account`.
	 * @returns The status, the headers — names lower-cased — and Stripe's answer, parsed.
	 * @throws ProviderCallError when Stripe answers with an error status — its status and `{ error }` in `extensions`.
	 * @throws HitRateLimitError when Stripe answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, its URL is not on Stripe's
	 * hosts, a `PUT` or `PATCH` carries parameters, or a file is among them; Stripe's `StripeConnectionError` when
	 * Stripe cannot be reached.
	 * @example
	 * ```ts
	 * const { data } = await stripe.call('POST /v1/refunds', { payment_intent: 'pi_123', amount: 500 });
	 * const { headers } = await stripe.call('GET /v1/customers/{id}', { id: 'cus_123' });
	 * await stripe.call('GET /v1/customers', { email: 'ada@example.com', expand: ['data.default_source'] });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options: CallOptions = {},
	): Promise<CallResponse<T>> {
		// 1. The verb and the target, its `{name}` placeholders filled from the parameters, which are then not sent
		//    again; a full URL only on Stripe's own hosts, so the key never travels anywhere else
		const { verb, target, params: rest } = parseCallMethod(method, params);
		const { path, apiBase } = toStripeTarget(target);

		// 2. Stripe takes a body on POST only, and the raw request sends no multipart one: both refused here, with the
		//    reason, rather than as the SDK's hint or as a file sent as the text `[object File]`
		const defined = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
		const hasParams = Object.keys(defined).length > 0;

		if (hasParams && (verb === 'PUT' || verb === 'PATCH')) {
			throw new Error(`Stripe takes a body on POST only, not on ${verb}`);
		}

		if (hasFile(defined)) {
			throw new Error('Stripe call() sends no file; upload it with the client: `client.files.create()`');
		}

		// 3. The other verbs carry their parameters in the path's query, in the notation Stripe reads
		const inQuery = verb !== 'POST';
		const query = inQuery && hasParams ? toStripeQuery(defined) : '';
		const fullPath = query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;

		// 4. The SDK's own timeout closes the socket; the deadline around it and the caller's signal make sure the
		//    caller gets a TimeoutError or the abort reason — and an already aborted signal sends nothing. The SDK's
		//    network retries are off: one would outlive the deadline and could apply a POST after the caller was
		//    told it failed. Neither the deadline nor the signal cancels a request Stripe already has
		const timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;

		const requestOptions: Stripe.RawRequestOptions = {
			timeout,
			maxNetworkRetries: 0,
			...(apiBase !== undefined ? { apiBase } : {}),
			...(options.headers !== undefined ? { additionalHeaders: options.headers } : {}),
		};

		try {
			const answer = await withTimeout(
				() => this.client.rawRequest(verb, fullPath, inQuery ? undefined : defined, requestOptions),
				timeout,
				options.signal ? { signal: options.signal } : {},
			);

			// 5. The SDK hangs the raw response on the answer, out of its enumerable keys: `statusCode` and a record
			//    from Node's client, `status` and `Headers` from the fetch one
			const last = (answer as { lastResponse?: StripeRawResponse } | null)?.lastResponse;

			return {
				status: last?.statusCode ?? last?.status ?? 200,
				headers: toHeaderRecord(last?.headers),
				data: answer as T,
			};
		} catch (error) {
			// 6. An answer with a status is Stripe refusing: the kit's error, Stripe's own as the cause. No status —
			//    a connection failure, a timeout — goes on as it is
			if (error instanceof Stripe.errors.StripeError && typeof error.statusCode === 'number') {
				throw toProviderCallError({
					provider: 'stripe',
					method,
					status: error.statusCode,
					body: { error: toStripeErrorBody(error.raw) },
					headers: error.headers,
					cause: error,
				});
			}

			throw error;
		}
	}

	/**
	 * Prove the secret key works with the cheapest read there is.
	 *
	 * @throws Stripe's authentication error when it does not.
	 */
	async verify(): Promise<void> {
		// 1. One customer is the smallest authenticated read; an invalid key fails here with Stripe's own error
		await this.client.customers.list({ limit: 1 });
	}
}

/**
 * The raw response the SDK hangs on an answer as `lastResponse`: Node's `IncomingMessage` or a fetch `Response`,
 * depending on the client's HTTP client.
 *
 * @internal
 */
interface StripeRawResponse {
	/** The status, from Node's client. */
	statusCode?: number;
	/** The status, from the fetch client. */
	status?: number;
	/** The headers: a record from Node's client, `Headers` from the fetch one. */
	headers?: HeadersLike;
}

/**
 * Turn the target of a {@link PaymentsDriverStripe.call} into the path the SDK takes and the base it goes to.
 *
 * @param target - A path from the API's root, or a full URL.
 * @returns The path with its query, and the SDK's base for a full URL; no base for a path, so the client's own host —
 * a `stripe-mock` in tests included — is kept.
 * @throws Error when a `{name}` placeholder is left, or the URL is not https or not on one of
 * {@link STRIPE_CALL_HOSTS}.
 * @internal
 */
const toStripeTarget = (target: string): { path: string; apiBase?: Stripe.RawRequestOptions['apiBase'] } => {
	// 1. A placeholder no parameter filled would reach Stripe as `%7Bname%7D`: refused before any request
	const unfilled = /\{([A-Za-z_][\w-]*)\}/.exec(target);

	if (unfilled) {
		throw new Error(`The call path needs a "${unfilled[1]}" parameter for its {${unfilled[1]}} placeholder`);
	}

	// 2. A path goes to the client's host as it is
	if (target.startsWith('/')) {
		return { path: target };
	}

	// 3. A full URL only over https and on a host the SDK knows a base for; the key would leak to any other
	const url = new URL(target);
	const apiBase = Object.hasOwn(STRIPE_CALL_HOSTS, url.host) ? STRIPE_CALL_HOSTS[url.host] : undefined;

	if (url.protocol !== 'https:' || apiBase === undefined) {
		throw new Error(`The call URL is not on a host of this provider: ${url.host}`);
	}

	return { path: `${url.pathname}${url.search}`, apiBase };
};

/**
 * Whether the parameters carry a file — a `Blob` or `File` — at the top level or in a list, which the SDK's raw
 * request cannot send.
 *
 * @param params - The defined parameters.
 * @returns `true` when a file is among them.
 * @internal
 */
const hasFile = (params: Record<string, unknown>): boolean => {
	// 1. A parameter itself, or an item of a list
	return Object.values(params).some(
		(value) => value instanceof Blob || (Array.isArray(value) && value.some((item) => item instanceof Blob)),
	);
};

/**
 * Encode parameters the way Stripe reads a query: nested keys in brackets, a list by its indexes.
 *
 * `{ expand: ['a'], created: { gte: 1 } }` → `expand[0]=a&created[gte]=1`. A flat `a=1&a=2` would reach Stripe as one
 * string, not a list, so the plain query helper of `@novastarter/utils` does not fit here.
 *
 * @param params - The defined parameters.
 * @returns The query without its leading `?`.
 * @internal
 */
const toStripeQuery = (params: Record<string, unknown>): string => {
	const search = new URLSearchParams();

	/**
	 * Append one value under its key, descending into lists and objects.
	 *
	 * @param key - The key so far, brackets included.
	 * @param value - The value under it.
	 */
	const append = (key: string, value: unknown): void => {
		// 1. Nothing for a value that was not given; a list by index and an object by key, the way the SDK does
		if (value === undefined || value === null) return;

		if (Array.isArray(value)) {
			value.forEach((item, index) => append(`${key}[${index}]`, item));
		} else if (value instanceof Date) {
			search.append(key, String(Math.floor(value.getTime() / 1000)));
		} else if (typeof value === 'object') {
			for (const [child, item] of Object.entries(value)) append(`${key}[${child}]`, item);
		} else {
			search.append(key, String(value));
		}
	};

	// 1. Every top-level parameter, then brackets kept readable, as Stripe accepts both forms
	for (const [key, value] of Object.entries(params)) append(key, value);

	return search.toString().replace(/%5B/g, '[').replace(/%5D/g, ']');
};

/**
 * The `error` object of Stripe's answer, as the SDK hands it on its exception, without what the SDK added to it.
 *
 * @param raw - The exception's `raw`: Stripe's `error`, plus the response's headers, status and request id.
 * @returns Stripe's `error` as it came: `type`, `code`, `message`, `param` and the like.
 * @internal
 */
const toStripeErrorBody = (raw: unknown): unknown => {
	// 1. The SDK copies the response's headers, status and request id onto the error; they are not Stripe's answer
	if (typeof raw !== 'object' || raw === null) return raw;

	const {
		headers: _headers,
		statusCode: _statusCode,
		requestId: _requestId,
		...error
	} = raw as Record<string, unknown>;

	return error;
};

/**
 * Whether what the SDK parsed is shaped like a Stripe event: an object with a string `id` and `type` and an object
 * under `data.object`.
 *
 * `constructEventAsync` verifies the signature and `JSON.parse`s the body, nothing more — a signed `{"hello":1}` comes
 * back as is, and a signed `null` or `"text"` as well. The three fields are what {@link toEvent} reads of every event.
 *
 * @param event - What `constructEventAsync` handed back.
 * @returns `true` for an event-shaped value.
 */
const isStripeEvent = (event: unknown): event is Stripe.Event => {
	// 1. JSON parses to any value; only an object can be an event
	if (typeof event !== 'object' || event === null) return false;

	// 2. The id keys the idempotency guard, the type picks the mapping, the object is what the mapping reads
	const { id, type, data } = event as { id?: unknown; type?: unknown; data?: { object?: unknown } | null };

	return (
		typeof id === 'string' &&
		typeof type === 'string' &&
		typeof data === 'object' &&
		data !== null &&
		typeof data.object === 'object' &&
		data.object !== null
	);
};
