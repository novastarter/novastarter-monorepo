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
import { Polar } from '@polar-sh/sdk';
import type { SubscriptionProrationBehavior } from '@polar-sh/sdk/models/components/subscriptionprorationbehavior.js';
import { SDKValidationError } from '@polar-sh/sdk/models/errors/sdkvalidationerror.js';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import { deliveryIdOf, toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

/**
 * Options of {@link PaymentsDriverPolar}, as given in the location's `options`.
 */
export type PaymentsDriverPolarConfig = {
	/** Organization access token from the Polar dashboard (`polar_oat_…`). */
	accessToken: string;
	/** Secret of the webhook endpoint, as entered in the dashboard. */
	webhookSecret: string;
	/** `sandbox` for the test environment; `production` unless given. */
	server?: 'production' | 'sandbox' | undefined;
	/**
	 * A client to use instead of one built from the token — tests hand in one with stubbed resources.
	 *
	 * @internal
	 */
	client?: Polar | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/payments`, so a location naming `polar` has its
 * options checked against {@link PaymentsDriverPolarConfig}.
 */
declare module '@novastarter/payments' {
	interface PaymentsDrivers {
		polar: PaymentsDriverPolarConfig;
	}
}

/**
 * The headers a Polar webhook carries, per the Standard Webhooks spec it follows.
 *
 * @defaultValue `webhook-id`, `webhook-timestamp`, `webhook-signature`
 */
export const WEBHOOK_HEADERS: readonly string[] = ['webhook-id', 'webhook-timestamp', 'webhook-signature'];

/**
 * How the kit's proration choice maps onto Polar's `proration_behavior`.
 *
 * @defaultValue `prorate` → `prorate`, `none` → `next_period`, `invoice` → `invoice`
 */
export const PRORATION: Record<NonNullable<UpdateSubscriptionInput['proration']>, SubscriptionProrationBehavior> = {
	prorate: 'prorate',
	none: 'next_period',
	invoice: 'invoice',
};

/**
 * The root of Polar's API for each server, which {@link PaymentsDriverPolar.call} joins its paths to.
 *
 * @defaultValue `production` → `https://api.polar.sh`, `sandbox` → `https://sandbox-api.polar.sh`
 */
export const POLAR_API_URLS: Readonly<Record<'production' | 'sandbox', string>> = {
	production: 'https://api.polar.sh',
	sandbox: 'https://sandbox-api.polar.sh',
};

/**
 * The hosts a full URL given to {@link PaymentsDriverPolar.call} may point at.
 *
 * @defaultValue `api.polar.sh`, `sandbox-api.polar.sh`
 * @internal
 */
export const POLAR_CALL_HOSTS: readonly string[] = ['api.polar.sh', 'sandbox-api.polar.sh'];

/**
 * Driver for [Polar](https://polar.sh): hosted checkout, the customer portal, subscriptions and orders over
 * `@polar-sh/sdk`, webhooks verified with the endpoint's secret.
 *
 * Polar is a merchant of record: it sells products (the catalog's `providerIds.polar` are product ids) and issues
 * orders where Stripe issues invoices.
 *
 * @example
 * ```ts
 * import { usePayments } from '@novastarter/payments';
 * import { PaymentsDriverPolar } from '@novastarter/payments-driver-polar';
 * import { env } from './env';
 *
 * const payments = usePayments();
 *
 * payments.registerDriver('polar', PaymentsDriverPolar);
 * payments.registerLocation('default', {
 * 	driver: 'polar',
 * 	options: {
 * 		accessToken: env.PAYMENTS_POLAR_ACCESS_TOKEN,
 * 		webhookSecret: env.PAYMENTS_POLAR_WEBHOOK_SECRET,
 * 		server: 'sandbox',
 * 	},
 * });
 * ```
 */
export class PaymentsDriverPolar implements PaymentsDriver {
	/**
	 * The `@polar-sh/sdk` client every request goes through.
	 *
	 * @internal
	 */
	private readonly client: Polar;

	/**
	 * The webhook endpoint's secret, checked on every delivery.
	 *
	 * @internal
	 */
	private readonly webhookSecret: string;

	/**
	 * Polar's API as a {@link call} reaches it: the configured server's root, Polar's hosts, the access token as the
	 * bearer token — the SDK keeps its own copy private.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Access token, webhook secret, environment.
	 * @throws InvalidConfigError without a token or a webhook secret — a deployment that cannot verify webhooks would
	 * drift from Polar silently.
	 */
	constructor(config: PaymentsDriverPolarConfig) {
		// Fail at registration for the two values nothing works without, rather than on the first request
		if (!config.accessToken) {
			throw new InvalidConfigError({ reason: 'The polar payments driver needs an "accessToken"' });
		}

		if (!config.webhookSecret) {
			throw new InvalidConfigError({ reason: 'The polar payments driver needs a "webhookSecret"' });
		}

		// The sandbox has its own tokens and products
		this.client =
			config.client ??
			new Polar({
				accessToken: config.accessToken,
				server: config.server ?? 'production',
			});

		this.webhookSecret = config.webhookSecret;

		// `call()` makes its own request with the same token against the same server, the SDK having no raw one
		this.api = {
			provider: 'polar',
			baseUrl: POLAR_API_URLS[config.server ?? 'production'],
			hosts: POLAR_CALL_HOSTS,
			headers: { authorization: `Bearer ${config.accessToken}` },
		};
	}

	/**
	 * Create the Polar customer for an organization.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		// Optional fields are only sent when given, so Polar keeps its defaults otherwise
		const customer = await this.client.customers.create({
			email: input.email,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});

		// Polar's metadata may hold numbers and booleans; the kit's is flat strings
		return {
			id: customer.id,
			email: customer.email ?? input.email,
			name: customer.name ?? null,
			metadata: toMetadata(customer.metadata),
		};
	}

	/**
	 * Start a hosted checkout for a product.
	 *
	 * The trial is expressed in days, and a checkout without one has the product's own trial switched off; the
	 * metadata goes on the checkout, and Polar copies it onto the subscription it creates.
	 *
	 * @param input - Customer, product, seats, redirects, trial, metadata.
	 * @returns The checkout and its page.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// One product per checkout; the trial is expressed in days and the cancel URL is Polar's return URL. Without
		// a positive trial `allowTrial: false` is sent, because Polar otherwise falls back to the product's own trial
		const checkout = await this.client.checkouts.create({
			products: [input.priceId],
			customerId: input.customerId,
			successUrl: input.successUrl,
			returnUrl: input.cancelUrl,
			...(input.quantity !== undefined ? { seats: input.quantity } : {}),
			...(input.allowPromotionCodes !== undefined ? { allowDiscountCodes: input.allowPromotionCodes } : {}),
			...(input.trialDays !== undefined && input.trialDays > 0
				? { allowTrial: true, trialInterval: 'day' as const, trialIntervalCount: input.trialDays }
				: { allowTrial: false }),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});

		return { id: checkout.id, url: checkout.url, expiresAt: checkout.expiresAt };
	}

	/**
	 * Open the customer portal through a customer session.
	 *
	 * @param input - Customer and return URL.
	 * @returns The portal page.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// A customer session is what opens the portal; the URL is all the caller needs
		const session = await this.client.customerSessions.create({
			customerId: input.customerId,
			returnUrl: input.returnUrl,
		});

		return { url: session.customerPortalUrl };
	}

	/**
	 * Read a subscription.
	 *
	 * @param subscriptionId - Polar's id.
	 * @returns The subscription, normalised.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// The model carries the product and the periods, which is all the mapping reads
		return toSubscription(await this.client.subscriptions.get({ id: subscriptionId }));
	}

	/**
	 * Change the product (plan) and/or the seat count.
	 *
	 * Polar takes one kind of change per call, so a plan change and a seat change are two updates; the second one's
	 * result is what comes back.
	 *
	 * @param input - Subscription, new product and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws InvalidPayloadError when neither a price nor a seat count is given.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		// The proration behavior holds whichever request carries the change, so it is resolved once; the
		// accumulator keeps the last update's result, which is the state that comes back
		const prorationBehavior = PRORATION[input.proration ?? 'prorate'];
		let subscription;

		if (input.priceId !== undefined) {
			subscription = await this.client.subscriptions.update({
				id: input.subscriptionId,
				subscriptionUpdate: { productId: input.priceId, prorationBehavior },
			});
		}

		// The seat change's result is the later state, so it is the one returned
		if (input.quantity !== undefined) {
			subscription = await this.client.subscriptions.update({
				id: input.subscriptionId,
				subscriptionUpdate: { seats: input.quantity, prorationBehavior },
			});
		}

		// Neither given: a caller's mistake, reported rather than answered with an unchanged subscription
		if (!subscription) {
			throw new InvalidPayloadError({
				reason: `Nothing to update on Polar subscription "${input.subscriptionId}": give a priceId or a quantity`,
			});
		}

		return toSubscription(subscription);
	}

	/**
	 * Cancel a subscription: at the end of the period, or right away (`revoke`).
	 *
	 * @param input - Subscription, when, why.
	 * @returns The subscription after the request.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// The reason is recorded on Polar's side either way, as the customer's cancellation comment
		const comment = input.reason !== undefined ? { customerCancellationComment: input.reason } : {};

		// Right away is a revoke; at period end is a flag on the subscription
		const subscription = input.immediately
			? await this.client.subscriptions.update({
					id: input.subscriptionId,
					subscriptionUpdate: { revoke: true, ...comment },
				})
			: await this.client.subscriptions.update({
					id: input.subscriptionId,
					subscriptionUpdate: { cancelAtPeriodEnd: true, ...comment },
				});

		return toSubscription(subscription);
	}

	/**
	 * The customer's orders, most recent first, as invoices.
	 *
	 * @param input - Customer and how many.
	 * @returns The invoices, normalised.
	 * @throws Polar's `PolarError` when the request is refused, or its `HTTPClientError` when Polar cannot be reached.
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		const page = await this.client.orders.list({
			customerId: input.customerId,
			sorting: ['-created_at'],
			...(input.limit !== undefined ? { limit: input.limit } : {}),
		});

		return page.result.items.map(toInvoice);
	}

	/**
	 * Verify a webhook against the endpoint's secret and normalise its event.
	 *
	 * @param rawBody - The body byte for byte.
	 * @param headers - The request headers, lower-cased.
	 * @returns The event, or `null` for one the kit does not act on — including an event type this SDK does not know
	 * yet, once its signature verified.
	 * @throws InvalidPayloadError without the Standard Webhooks headers, for a body that is not JSON or not a Polar
	 * event, or for an event of a type this SDK knows whose payload its schema rejects — reported rather than dropped,
	 * so a change on Polar's side does not silently swallow every delivery of that type.
	 * @throws InvalidCredentialsError when the signature does not verify, or the timestamp is outside the tolerance.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// All three Standard Webhooks headers have to be there; a missing one is a malformed delivery, not a forged one
		const present: Record<string, string> = {};

		for (const name of WEBHOOK_HEADERS) {
			const value = headers[name];

			if (!value) {
				throw new InvalidPayloadError({ reason: `The delivery carries no ${name} header` });
			}

			present[name] = value;
		}

		// The SDK verifies the signature and the timestamp, then parses the body — in that order. Every header is
		// checked present above, so the delivery id is there
		try {
			return toEvent(validateEvent(rawBody, present, this.webhookSecret), deliveryIdOf(present));
		} catch (error) {
			// A signature that does not match, or a stale timestamp, is a credentials problem
			if (error instanceof WebhookVerificationError) {
				throw new InvalidCredentialsError();
			}

			// The SDK verifies before it parses, so a validation error here is a verified event this SDK cannot
			// read. Only an event of a type the SDK does not know is dropped — Polar adds types over time; a known
			// type whose payload fails the schema is refused, since dropping it would silently lose every delivery
			// of that type until the SDK is updated, and a body that is not an event at all is refused as well
			if (error instanceof SDKValidationError) {
				const type = eventTypeOf(rawBody);

				if (type !== undefined && isUnknownEventType(error)) return null;

				throw new InvalidPayloadError(
					{
						reason:
							type === undefined
								? 'The body is not a Polar event'
								: `The "${type}" event does not match this SDK's schema`,
					},
					{ cause: error },
				);
			}

			// The verifier parses the body once the signature matched, so a body that is not JSON surfaces here as
			// a bare SyntaxError: a payload problem the sender has to fix, not a failure of the driver
			if (error instanceof SyntaxError) {
				throw new InvalidPayloadError({ reason: 'The body is not JSON' }, { cause: error });
			}

			throw error;
		}
	}

	/**
	 * Make a request of any Polar endpoint with the location's access token, for what the SDK or the contract does not
	 * cover.
	 *
	 * `method` is the verb and the path from the API's root — `GET /v1/benefits/` — or a full URL on one of
	 * {@link POLAR_CALL_HOSTS}. The parameters of a `GET` or `DELETE` go in the query, a list as its key repeated, the
	 * others as a JSON body. A `{name}` in the path is filled from the parameter of that name, URL-encoded, and that
	 * parameter is not sent again.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Polar's API reference.
	 * @param method - The verb and the path, or a full URL on Polar's hosts.
	 * @param params - The placeholders' values, and the query of a `GET` or `DELETE` or the JSON body otherwise.
	 * @param options - A timeout over the default 30 seconds, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and Polar's answer, parsed; `undefined` for an empty one.
	 * @throws ProviderCallError when Polar answers with an error status — its status and `{ error, detail }` in
	 * `extensions`.
	 * @throws HitRateLimitError when Polar answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, or its URL is not
	 * on Polar's hosts.
	 * @example
	 * ```ts
	 * const { data } = await polar.call('GET /v1/benefits/', { limit: 20 });
	 * const { headers } = await polar.call('GET /v1/customers/{id}', { id: 'cus_123' });
	 * await polar.call('POST /v1/refunds/', { order_id: 'ord_123', reason: 'customer_request', amount: 500 });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// The shared request does it all: placeholders, Polar's hosts only — so the token never travels elsewhere —
		// the deadline, and an error status turned into the kit's error with Polar's answer
		return request<T>(this.api, method, params, options);
	}

	/**
	 * Prove the token works with the cheapest read there is.
	 *
	 * @throws Polar's authentication error when it does not.
	 */
	async verify(): Promise<void> {
		// One customer is the smallest authenticated read; an invalid token fails here with Polar's own error
		await this.client.customers.list({ limit: 1 });
	}
}

/**
 * The `type` of a body that is a JSON object with a string `type` — the shape of every Polar event, known to this SDK
 * or not.
 *
 * @param rawBody - The body text.
 * @returns The event type, or `undefined` for a body that is not event-shaped.
 */
const eventTypeOf = (rawBody: string): string | undefined => {
	// A body that is not JSON, or not an object with a string `type`, is not an event of any version
	try {
		const parsed: unknown = JSON.parse(rawBody);
		const type = typeof parsed === 'object' && parsed !== null ? (parsed as { type?: unknown }).type : undefined;

		return typeof type === 'string' ? type : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Whether a validation error is the SDK's own "unknown event type" refusal, the one failure of `validateEvent` that
 * means the event is well-formed but newer than this SDK.
 *
 * The SDK wraps every parse failure in an outer `SDKValidationError`; for an unknown type the cause is an inner
 * `SDKValidationError` whose raw message names it, while a known type whose payload fails its schema carries the
 * schema's `ZodError` as the cause. The two are told apart here so only the former is dropped.
 *
 * @param error - The error `validateEvent` threw.
 * @returns `true` for an unknown event type.
 */
const isUnknownEventType = (error: SDKValidationError): boolean => {
	// The inner error's `rawMessage` is the SDK's message before it appends the cause, so the prefix is stable
	return error.cause instanceof SDKValidationError && String(error.cause.rawMessage).startsWith('Unknown event type');
};
