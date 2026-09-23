import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import type { CallOptions, CallResponse } from '@novastarter/http';
import { useLogger } from '@novastarter/logger';
import type {
	BillingInterval,
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
import type {
	LsCheckoutAttributes,
	LsCustomerAttributes,
	LsDocument,
	LsListDocument,
	LsResource,
	LsSubscriptionAttributes,
	LsSubscriptionInvoiceAttributes,
	LsVariantAttributes,
	LsWebhookPayload,
} from '../types.js';
import { type ApiFetch, LemonSqueezyApi } from './api.js';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toSubscription } from './to-subscription.js';
import { SIGNATURE_HEADER, verifySignature } from './verify-signature.js';

/**
 * Options of {@link PaymentsDriverLemonSqueezy}, as given in the location's `options`.
 */
export type PaymentsDriverLemonSqueezyConfig = {
	/** API key from Settings → API in the Lemon Squeezy dashboard. */
	apiKey: string;
	/** Signing secret entered when the webhook was created (Settings → Webhooks). */
	webhookSecret: string;
	/** The store the checkouts and customers belong to (Settings → Stores, the numeric id). */
	storeId: string | number;
	/** Another base URL of the API — a stand-in for tests. */
	apiUrl?: string | undefined;
	/** Request timeout in milliseconds: a whole number from 1 to 2^31 − 1 (`MAX_TIMEOUT` of the API client). */
	timeout?: number | undefined;
	/**
	 * A fetch to send with instead of the platform's — tests hand in a fake.
	 *
	 * @internal
	 */
	fetch?: ApiFetch | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/payments`, so a location naming `lemonsqueezy` has its
 * options checked against {@link PaymentsDriverLemonSqueezyConfig}.
 */
declare module '@novastarter/payments' {
	interface PaymentsDrivers {
		lemonsqueezy: PaymentsDriverLemonSqueezyConfig;
	}
}

/**
 * How many subscriptions one list request asks for: the most Lemon Squeezy hands out per page, so a customer's
 * subscriptions are collected in as few reads as possible.
 *
 * @defaultValue 100
 */
const SUBSCRIPTIONS_PAGE_SIZE = 100;

/**
 * How many pages of subscriptions one `listInvoices` call reads at most: a bound, so a customer with very many
 * subscriptions — or a server reporting a huge `lastPage` — cannot turn the call into an unbounded sequence of
 * blocking round trips. Ten pages of the largest page size cover a thousand subscriptions; past that the result is
 * truncated and the truncation is reported.
 *
 * @defaultValue 10
 */
const MAX_SUBSCRIPTION_PAGES = 10;

/**
 * Driver for [Lemon Squeezy](https://www.lemonsqueezy.com): hosted checkouts, the customer portal, subscriptions
 * and subscription invoices over the JSON:API (`/v1`), webhooks verified with the signing secret.
 *
 * Lemon Squeezy is a merchant of record that sells variants of products: the catalog's `providerIds.lemonsqueezy`
 * are variant ids. Trials are a property of the variant, a checkout has no cancel page (its own back link leads to
 * the store), the portal returns to the store, and a subscription is cancelled at the end of its paid period only —
 * `cancelSubscription` with `immediately` is refused with an Error rather than downgraded to a period-end cancellation.
 *
 * @example
 * ```ts
 * import { usePayments } from '@novastarter/payments';
 * import { PaymentsDriverLemonSqueezy } from '@novastarter/payments-driver-lemonsqueezy';
 * import { env } from './env';
 *
 * const payments = usePayments();
 *
 * payments.registerDriver('lemonsqueezy', PaymentsDriverLemonSqueezy);
 * payments.registerLocation('default', {
 * 	driver: 'lemonsqueezy',
 * 	options: {
 * 		apiKey: env.PAYMENTS_LEMONSQUEEZY_API_KEY,
 * 		webhookSecret: env.PAYMENTS_LEMONSQUEEZY_WEBHOOK_SECRET,
 * 		storeId: env.PAYMENTS_LEMONSQUEEZY_STORE_ID,
 * 	},
 * });
 * ```
 */
export class PaymentsDriverLemonSqueezy implements PaymentsDriver {
	/**
	 * The JSON:API client every request goes through.
	 *
	 * @internal
	 */
	private readonly api: LemonSqueezyApi;

	/**
	 * The signing secret webhook deliveries are verified against.
	 *
	 * @internal
	 */
	private readonly webhookSecret: string;

	/**
	 * The store customers and checkouts belong to, as the API wants it in relationships.
	 *
	 * @internal
	 */
	private readonly storeId: string;

	/**
	 * The billing interval of every variant seen, read once from the API.
	 *
	 * @internal
	 */
	private readonly intervals = new Map<string, BillingInterval>();

	/**
	 * Create a driver from its location options.
	 *
	 * @param config - API key, webhook secret, store.
	 * @throws Error without a key, a webhook secret or a store — a deployment that cannot verify webhooks would drift
	 * from Lemon Squeezy silently, and a checkout belongs to a store.
	 * @throws RangeError for a timeout that is not a whole number from 1 to 2^31 − 1, which would fail every request
	 * instead of bounding it.
	 */
	constructor(config: PaymentsDriverLemonSqueezyConfig) {
		// 1. Fail at registration for the three values nothing works without, rather than on the first request
		if (!config.apiKey) {
			throw new Error('The lemonsqueezy payments driver needs an "apiKey"');
		}

		if (!config.webhookSecret) {
			throw new Error('The lemonsqueezy payments driver needs a "webhookSecret"');
		}

		if (config.storeId === undefined || config.storeId === '') {
			throw new Error('The lemonsqueezy payments driver needs a "storeId"');
		}

		// 2. The client takes the same options: key, base URL, timeout and the fetch to send with; it is the one that
		//    refuses a timeout its abort signal cannot hold
		this.api = new LemonSqueezyApi(config);
		this.webhookSecret = config.webhookSecret;

		// 3. The API wants the store id as a string in relationships, whatever the configuration gave
		this.storeId = String(config.storeId);
	}

	/**
	 * Create the Lemon Squeezy customer for an organization.
	 *
	 * Customers carry no custom data on Lemon Squeezy — the metadata reaches it with the checkout instead — so a
	 * caller asking to store some is refused rather than answered with a customer that lost it silently.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 * @throws Error when `input.metadata` is given: Lemon Squeezy customers carry no custom data, so the metadata
	 * would be dropped; pass it to `createCheckoutSession` instead, which sends it as the checkout's custom data.
	 * @throws LemonSqueezyApiError when Lemon Squeezy refuses the request or cannot be reached.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		// 1. Refused before any request: the API has no field for it, so storing the metadata is impossible — better
		//    loud now than a silent loss the return value's empty `metadata` would only reveal in production
		if (input.metadata !== undefined) {
			throw new Error(
				'The lemonsqueezy payments driver cannot store customer metadata: Lemon Squeezy keeps custom data on checkouts, not on customers — pass the metadata to createCheckoutSession instead',
			);
		}

		// 2. The name is required by the API; the email stands in for a customer without one
		const { data } = await this.api.request<LsDocument<LsCustomerAttributes>>('POST', '/customers', {
			data: {
				type: 'customers',
				attributes: { email: input.email, name: input.name ?? input.email },
				relationships: { store: { data: { type: 'stores', id: this.storeId } } },
			},
		});

		// 3. No metadata: Lemon Squeezy keeps custom data on checkouts and orders, not on customers
		return { id: data.id, email: data.attributes.email, name: data.attributes.name || null, metadata: {} };
	}

	/**
	 * Start a hosted checkout for a variant, prefilled with the customer's email and name.
	 *
	 * The metadata goes as the checkout's custom data, which Lemon Squeezy carries on every event of the order and
	 * the subscription it creates. The quantity goes as the variant's quantity, for a variant priced per seat.
	 *
	 * @param input - Customer, variant, seats, success redirect, discount codes, metadata.
	 * @returns The checkout and its page.
	 * @throws Error when `input.priceId` is not a positive integer — the variant id the API expects.
	 * @throws LemonSqueezyApiError when Lemon Squeezy refuses the request or cannot be reached.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// 1. The catalog's price id is the variant id, and the API wants it numeric: anything else would be sent as
		//    JSON `null` and refused by the API with a message that does not name the cause, so the bad id is named
		//    here, before any request
		const variantId = Number(input.priceId);

		if (!Number.isInteger(variantId) || variantId <= 0) {
			throw new Error(
				`The lemonsqueezy payments driver needs a "priceId" that is a positive integer, got "${input.priceId}"`,
			);
		}

		// 2. The checkout is matched to the customer by email; the customer resource has it
		const { data: customer } = await this.api.request<LsDocument<LsCustomerAttributes>>(
			'GET',
			`/customers/${encodeURIComponent(input.customerId)}`,
		);

		// 3. Custom data and quantities are only sent when given, so the API keeps its defaults otherwise
		const { data } = await this.api.request<LsDocument<LsCheckoutAttributes>>('POST', '/checkouts', {
			data: {
				type: 'checkouts',
				attributes: {
					checkout_data: {
						email: customer.attributes.email,
						name: customer.attributes.name,
						...(input.metadata !== undefined ? { custom: input.metadata } : {}),
						...(input.quantity !== undefined
							? { variant_quantities: [{ variant_id: variantId, quantity: input.quantity }] }
							: {}),
					},
					product_options: { redirect_url: input.successUrl, enabled_variants: [variantId] },
					...(input.allowPromotionCodes !== undefined
						? { checkout_options: { discount: input.allowPromotionCodes } }
						: {}),
				},
				relationships: {
					store: { data: { type: 'stores', id: this.storeId } },
					variant: { data: { type: 'variants', id: String(variantId) } },
				},
			},
		});

		// 4. A checkout may have no expiry; the page URL is what the browser is sent to
		return {
			id: data.id,
			url: data.attributes.url,
			expiresAt: data.attributes.expires_at ? new Date(data.attributes.expires_at) : null,
		};
	}

	/**
	 * Open the customer portal: the signed link Lemon Squeezy keeps on the customer, valid for a day.
	 *
	 * @param input - Customer (the portal returns to the store, not to `returnUrl`).
	 * @returns The portal page.
	 * @throws Error when the customer has no portal link yet — none until a first order.
	 * @throws LemonSqueezyApiError when Lemon Squeezy refuses the request or cannot be reached.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// 1. There is no portal session resource: the customer carries a signed portal link
		const { data } = await this.api.request<LsDocument<LsCustomerAttributes>>(
			'GET',
			`/customers/${encodeURIComponent(input.customerId)}`,
		);

		// 2. The link only exists once the customer ordered something; before that there is nothing to open
		if (!data.attributes.urls.customer_portal) {
			throw new Error(`Lemon Squeezy customer "${input.customerId}" has no customer portal yet`);
		}

		return { url: data.attributes.urls.customer_portal };
	}

	/**
	 * Read a subscription.
	 *
	 * @param subscriptionId - Lemon Squeezy's id.
	 * @returns The subscription, normalised — without metadata, which only the webhooks carry.
	 * @throws LemonSqueezyApiError when there is no such subscription, or Lemon Squeezy cannot be reached.
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// 1. The subscription resource, then the interval of its variant — the subscription does not carry it
		const { data } = await this.api.request<LsDocument<LsSubscriptionAttributes>>(
			'GET',
			`/subscriptions/${encodeURIComponent(subscriptionId)}`,
		);

		return toSubscription(data, { interval: await this.intervalOf(String(data.attributes.variant_id)) });
	}

	/**
	 * Change the variant (plan) and/or the seat count.
	 *
	 * A variant change is an update of the subscription; a seat change is an update of its first subscription item.
	 * `proration: 'invoice'` charges the difference now, `'none'` skips the proration — on either request, so a seat
	 * change alone is not prorated behind the caller's back.
	 *
	 * @param input - Subscription, new variant and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws Error when neither a variant nor a seat count is given, when `input.priceId` is not a positive integer —
	 * the variant id the API expects — or the subscription has no item to size.
	 * @throws LemonSqueezyApiError when Lemon Squeezy refuses the change or cannot be reached.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		// 1. An update with nothing to change is a caller's mistake, not a request to send
		if (input.priceId === undefined && input.quantity === undefined) {
			throw new Error(
				`Nothing to update on Lemon Squeezy subscription "${input.subscriptionId}": give a priceId or a quantity`,
			);
		}

		// 2. The id URL-encoded once, used by every request below
		const id = encodeURIComponent(input.subscriptionId);

		// 3. Both endpoints take the same two flags, so the proration asked for holds whichever request carries the
		//    change: `'invoice'` charges the difference now, `'none'` skips the proration, `'prorate'` leaves it to
		//    the next renewal
		const invoiceImmediately = input.proration === 'invoice';
		const disableProrations = input.proration === 'none';

		// 4. A variant change is an update of the subscription itself; the price id is the variant id, numeric the way
		//    the API expects — a non-numeric one would be sent as JSON `null` and refused with a message that does not
		//    name the cause, so it is named here, before any request
		if (input.priceId !== undefined) {
			const variantId = Number(input.priceId);

			if (!Number.isInteger(variantId) || variantId <= 0) {
				throw new Error(
					`The lemonsqueezy payments driver needs a "priceId" that is a positive integer, got "${input.priceId}"`,
				);
			}

			await this.api.request<LsDocument<LsSubscriptionAttributes>>('PATCH', `/subscriptions/${id}`, {
				data: {
					type: 'subscriptions',
					id: input.subscriptionId,
					attributes: {
						variant_id: variantId,
						invoice_immediately: invoiceImmediately,
						disable_prorations: disableProrations,
					},
				},
			});
		}

		// 5. The seat count lives on the subscription item, which the subscription names
		if (input.quantity !== undefined) {
			const { data } = await this.api.request<LsDocument<LsSubscriptionAttributes>>('GET', `/subscriptions/${id}`);
			const item = data.attributes.first_subscription_item;

			if (!item) {
				throw new Error(`Lemon Squeezy subscription "${input.subscriptionId}" has no subscription item to size`);
			}

			await this.api.request('PATCH', `/subscription-items/${item.id}`, {
				data: {
					type: 'subscription-items',
					id: String(item.id),
					attributes: {
						quantity: input.quantity,
						invoice_immediately: invoiceImmediately,
						disable_prorations: disableProrations,
					},
				},
			});
		}

		// 6. Read back rather than trusting the PATCH responses: the two requests each answer a partial state
		return this.getSubscription(input.subscriptionId);
	}

	/**
	 * Cancel a subscription at the end of its paid period — the only cancellation Lemon Squeezy offers.
	 *
	 * An immediate cancellation is refused rather than downgraded: resolving it as a period-end cancellation would
	 * leave the customer with paid access the caller asked to revoke.
	 *
	 * @param input - Subscription (the reason is not recorded by Lemon Squeezy).
	 * @returns The subscription after the request: `cancelAtPeriodEnd`, `cancelAt` set.
	 * @throws Error when `immediately` is set: Lemon Squeezy cannot end a subscription before its period does.
	 * @throws LemonSqueezyApiError when there is no such subscription, or Lemon Squeezy cannot be reached.
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// 1. Refuse `immediately` before any request, as createCustomer refuses metadata it cannot store: a silent
		//    period-end cancellation would break the contract's promise to stop access now
		if (input.immediately) {
			throw new Error(
				'Lemon Squeezy cannot end a subscription immediately: it only cancels at the end of the paid period. ' +
					'Cancel without `immediately`, or refund and expire it through the Lemon Squeezy dashboard or API',
			);
		}

		// 2. DELETE answers the subscription as it now stands — cancelled, valid until `ends_at`
		const { data } = await this.api.request<LsDocument<LsSubscriptionAttributes>>(
			'DELETE',
			`/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
		);

		return toSubscription(data, { interval: await this.intervalOf(String(data.attributes.variant_id)) });
	}

	/**
	 * The invoices of a customer's subscriptions, most recent first.
	 *
	 * Subscription invoices are filtered by subscription, subscriptions by email: the customer's email leads to the
	 * subscriptions — every page of them, up to {@link MAX_SUBSCRIPTION_PAGES} — each subscription to its invoices,
	 * one read per subscription. A customer with subscriptions past the cap contributes the invoices of the pages
	 * that were read; the truncation is reported through the logger.
	 *
	 * @param input - Customer and how many.
	 * @returns The invoices, normalised.
	 * @throws LemonSqueezyApiError when there is no such customer, or Lemon Squeezy cannot be reached.
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		// 1. The caller's limit, with the page size of one subscription's invoices defaulting to it below
		const limit = input.limit ?? 20;

		// 2. Subscriptions cannot be filtered by customer id, only by email — so the customer is read first
		const { data: customer } = await this.api.request<LsDocument<LsCustomerAttributes>>(
			'GET',
			`/customers/${encodeURIComponent(input.customerId)}`,
		);

		// 3. Every subscription of the email, page by page: the API answers ten per page unless told otherwise, and a
		//    subscription left on a later page would silently contribute no invoices, however large the limit; the page
		//    count is capped, so a customer with very many subscriptions cannot hold the call hostage — past the cap
		//    the result is truncated and the truncation is reported, not silent
		const query = `filter[store_id]=${encodeURIComponent(this.storeId)}&filter[user_email]=${encodeURIComponent(customer.attributes.email)}&page[size]=${SUBSCRIPTIONS_PAGE_SIZE}`;
		const subscriptions: LsResource<LsSubscriptionAttributes>[] = [];
		let lastPage = 1;

		for (let page = 1; page <= Math.min(lastPage, MAX_SUBSCRIPTION_PAGES); page++) {
			const list = await this.api.request<LsListDocument<LsSubscriptionAttributes>>(
				'GET',
				`/subscriptions?${query}&page[number]=${page}`,
			);

			subscriptions.push(...list.data);
			lastPage = list.meta?.page?.lastPage ?? 1;
		}

		if (lastPage > MAX_SUBSCRIPTION_PAGES) {
			useLogger().warn(
				`Lemon Squeezy customer "${input.customerId}" has subscriptions past page ${MAX_SUBSCRIPTION_PAGES}; listInvoices read the first ${MAX_SUBSCRIPTION_PAGES} pages and left the rest unread`,
			);
		}

		// 4. Only this customer's subscriptions: another customer of the store could share the email
		const own = subscriptions.filter(
			(subscription) => String(subscription.attributes.customer_id) === input.customerId,
		);

		// 5. One invoice page per subscription, in parallel; each page is capped so no subscription floods the result
		const pages = await Promise.all(
			own.map((subscription) =>
				this.api.request<LsListDocument<LsSubscriptionInvoiceAttributes>>(
					'GET',
					`/subscription-invoices?filter[subscription_id]=${encodeURIComponent(subscription.id)}&page[size]=${limit}`,
				),
			),
		);

		// 6. Merge the pages, newest first, and cut to the limit the caller asked for
		return pages
			.flatMap((page) => page.data)
			.map(toInvoice)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.slice(0, limit);
	}

	/**
	 * Verify a webhook against the signing secret and normalise its event.
	 *
	 * The subscription events carry no billing interval, so mapping one reads the variant synchronously
	 * (`GET /variants/:id`, cached per variant for the process): an API failure there turns a verified delivery into
	 * a 500, which Lemon Squeezy retries — the event is applied once it answers.
	 *
	 * @param rawBody - The body byte for byte.
	 * @param headers - The request headers, lower-cased.
	 * @returns The event, or `null` for one the kit does not act on.
	 * @throws InvalidPayloadError without the `x-signature` header, or for a body that is not a Lemon Squeezy event.
	 * @throws InvalidCredentialsError when the signature does not verify.
	 * @throws LemonSqueezyApiError when the variant read of a subscription event fails — reported as a 500, so Lemon
	 * Squeezy redelivers.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// 1. Without a signature header there is nothing to verify against; the delivery is malformed, not forged
		const signature = headers[SIGNATURE_HEADER];

		if (!signature) {
			throw new InvalidPayloadError({ reason: `The delivery carries no ${SIGNATURE_HEADER} header` });
		}

		// 2. The signature first, before anything is read from the body
		if (!verifySignature(rawBody, signature, this.webhookSecret)) {
			throw new InvalidCredentialsError();
		}

		// 3. A verified body has to be a delivery: an event name under `meta`, a resource with its attributes under
		//    `data` — the mapping reads all three, so a body missing one is refused as not the provider's event rather
		//    than crashing the route into a 500 that Lemon Squeezy would keep retrying
		let payload: LsWebhookPayload;

		try {
			payload = JSON.parse(rawBody) as LsWebhookPayload;
		} catch {
			throw new InvalidPayloadError({ reason: 'The body is not JSON' });
		}

		if (
			typeof payload?.meta?.event_name !== 'string' ||
			typeof payload.data?.id !== 'string' ||
			typeof payload.data.attributes !== 'object' ||
			payload.data.attributes === null
		) {
			throw new InvalidPayloadError({ reason: 'The body is not a Lemon Squeezy event' });
		}

		// 4. The mapping reads the variant's interval on demand — only the subscription events need it
		return toEvent(payload, (variantId) => this.intervalOf(variantId));
	}

	/**
	 * Make a request of any Lemon Squeezy endpoint with the location's key, timeout and fetch, for what the contract
	 * does not cover.
	 *
	 * `method` is the verb and the path from the API's root — `GET /v1/discounts` — or a full URL on
	 * `api.lemonsqueezy.com`. The parameters of a `GET` or `DELETE` go in the query, JSON:API's brackets in the key
	 * (`'filter[store_id]': 1`), the others as the JSON:API document of the body. A `{name}` in the path is filled
	 * from the parameter of that name, URL-encoded, and that parameter is not sent again.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Lemon Squeezy's API reference.
	 * @param method - The verb and the path, or a full URL on Lemon Squeezy's host.
	 * @param params - The placeholders' values, and the query of a `GET` or `DELETE` or the body otherwise.
	 * @param options - A timeout over the location's, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and the answer, parsed; `undefined` for an empty one.
	 * @throws ProviderCallError when Lemon Squeezy answers with an error status — its status and `{ errors }` in
	 * `extensions`.
	 * @throws HitRateLimitError when Lemon Squeezy answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, or its URL is not
	 * on Lemon Squeezy's host.
	 * @example
	 * ```ts
	 * const { data } = await lemonsqueezy.call('GET /v1/discounts', { 'filter[store_id]': 1 });
	 * const { headers } = await lemonsqueezy.call('GET /v1/orders/{id}', { id: 123 });
	 * await lemonsqueezy.call('POST /v1/orders/123/refund', {
	 * 	data: { type: 'orders', id: '123', attributes: { amount: 500 } },
	 * });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. The client holds the key, the timeout and the fetch; the request is its to make
		return this.api.call<T>(method, params, options);
	}

	/**
	 * Prove the key works with the cheapest read there is: the authenticated user.
	 *
	 * @throws LemonSqueezyApiError when it does not.
	 */
	async verify(): Promise<void> {
		// 1. `/users/me` needs nothing but a valid key and answers the same for every store
		await this.api.request('GET', '/users/me');
	}

	/**
	 * The billing interval of a variant, read once — the subscription does not carry it.
	 *
	 * @param variantId - The variant.
	 * @returns The interval; `month` for a variant that is not a subscription (a one-time purchase).
	 * @internal
	 */
	private async intervalOf(variantId: string): Promise<BillingInterval> {
		// 1. A variant's interval never changes, so one read per variant serves the process lifetime
		const cached = this.intervals.get(variantId);

		if (cached) return cached;

		// 2. A one-time variant has no interval; `month` keeps the normalised shape whole
		const { data } = await this.api.request<LsDocument<LsVariantAttributes>>(
			'GET',
			`/variants/${encodeURIComponent(variantId)}`,
		);

		const interval = data.attributes.interval ?? 'month';

		this.intervals.set(variantId, interval);

		return interval;
	}
}
