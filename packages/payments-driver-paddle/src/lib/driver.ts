import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
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
import { Environment, Paddle, type ProrationBillingMode } from '@paddle/paddle-node-sdk';
import { toEvent } from './to-event.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

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
 * Driver for [Paddle Billing](https://www.paddle.com) (API v2): transactions as the checkout and the invoices, the
 * customer portal, subscriptions over `@paddle/paddle-node-sdk`, webhooks verified with the destination's secret.
 *
 * Paddle is a merchant of record that bills prices (the catalog's `providerIds.paddle` are price ids, `pri_…`).
 * Its checkout is Paddle.js on a page of the app: a checkout session here is a transaction whose `checkout.url`
 * is that page with the transaction id, and the success redirect is Paddle.js's (`checkout.settings.successUrl`),
 * so `successUrl` / `cancelUrl` of the input have no counterpart. Trials and discount codes are set on the price
 * and the checkout in Paddle rather than per session.
 *
 * @example
 * ```ts
 * usePayments().registerDriver('paddle', PaymentsDriverPaddle);
 * usePayments().registerLocation('default', {
 * 	driver: 'paddle',
 * 	options: {
 * 		apiKey: env['PAYMENTS_PADDLE_API_KEY'],
 * 		webhookSecret: env['PAYMENTS_PADDLE_WEBHOOK_SECRET'],
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
	 * Create a driver from its location options.
	 *
	 * @param config - API key, webhook secret, environment, checkout page.
	 * @throws Error without a key or a webhook secret — a deployment that cannot verify webhooks would drift from
	 * Paddle silently.
	 */
	constructor(config: PaymentsDriverPaddleConfig) {
		// 1. Fail at registration for the two values nothing works without, rather than on the first request
		if (!config.apiKey) {
			throw new Error('The paddle payments driver needs an "apiKey"');
		}

		if (!config.webhookSecret) {
			throw new Error('The paddle payments driver needs a "webhookSecret"');
		}

		// 2. The SDK takes a base URL in place of an environment name, which is how a stand-in is reached
		const environment = config.environment === 'sandbox' ? Environment.sandbox : Environment.production;

		this.client =
			config.client ??
			new Paddle(config.apiKey, { environment: (config.apiUrl as Environment | undefined) ?? environment });

		this.webhookSecret = config.webhookSecret;
		this.checkoutUrl = config.checkoutUrl;
	}

	/**
	 * Create the Paddle customer for an organization.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		// 1. Optional fields are only sent when given; the metadata becomes Paddle's custom data
		const customer = await this.client.customers.create({
			email: input.email,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.metadata !== undefined ? { customData: input.metadata } : {}),
		});

		// 2. Custom data comes back as JSON; the kit's metadata is flat strings
		return { id: customer.id, email: customer.email, name: customer.name, metadata: toMetadata(customer.customData) };
	}

	/**
	 * Start a checkout: a transaction for the price, whose payment link opens Paddle Checkout on the app's page.
	 *
	 * The metadata goes on the transaction as custom data; Paddle copies it onto the subscription it creates.
	 *
	 * @param input - Customer, price, seats, metadata (the redirects and the trial are Paddle's, see the class).
	 * @returns The transaction and its payment link.
	 * @throws Error when Paddle hands back no payment link — the account has no default payment link and the
	 * location names no checkout page.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// 1. A transaction for the price and the seats; the checkout page is the configured one or Paddle's default
		const transaction = await this.client.transactions.create({
			items: [{ priceId: input.priceId, quantity: input.quantity ?? 1 }],
			customerId: input.customerId,
			...(input.metadata !== undefined ? { customData: input.metadata } : {}),
			...(this.checkoutUrl !== undefined ? { checkout: { url: this.checkoutUrl } } : {}),
		});

		// 2. Without a payment link there is nowhere to send the browser; Paddle only fills it when a page is known
		if (!transaction.checkout?.url) {
			throw new Error(
				`Paddle transaction "${transaction.id}" has no checkout URL: set the "checkoutUrl" option or a default payment link in Paddle`,
			);
		}

		// 3. A transaction does not expire the way a hosted session does
		return { id: transaction.id, url: transaction.checkout.url, expiresAt: null };
	}

	/**
	 * Open the customer portal through a portal session.
	 *
	 * @param input - Customer (the return URL is the portal's own "back" link, configured in Paddle).
	 * @returns The portal page.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// 1. No subscription ids: the overview link covers every subscription of the customer
		const session = await this.client.customerPortalSessions.create(input.customerId, []);

		return { url: session.urls.general.overview };
	}

	/**
	 * Read a subscription.
	 *
	 * @param subscriptionId - Paddle's id.
	 * @returns The subscription, normalised.
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// 1. The entity carries the items with their prices, which is all the mapping reads
		return toSubscription(await this.client.subscriptions.get(subscriptionId));
	}

	/**
	 * Change the price (plan) and/or the seat count.
	 *
	 * Paddle takes the full list of items on an update, so the current item is read first and rewritten with the
	 * new price and/or quantity.
	 *
	 * @param input - Subscription, new price and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws Error when neither a price nor a seat count is given.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		// 1. An update with nothing to change is a caller's mistake, not a request to send
		if (input.priceId === undefined && input.quantity === undefined) {
			throw new Error(
				`Nothing to update on Paddle subscription "${input.subscriptionId}": give a priceId or a quantity`,
			);
		}

		// 2. The item as it is, for whichever of price and quantity stays
		const current = toSubscription(await this.client.subscriptions.get(input.subscriptionId));

		// 3. Paddle takes the full item list, so the one item is rewritten with the merged price and quantity
		const updated = await this.client.subscriptions.update(input.subscriptionId, {
			items: [{ priceId: input.priceId ?? current.priceId, quantity: input.quantity ?? current.quantity }],
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
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// 1. One call either way: the effective date is what tells a scheduled cancellation from an immediate one
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
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		const limit = input.limit ?? 20;

		// 1. Only the billed states: a draft or an abandoned checkout is not an invoice
		const page = this.client.transactions.list({
			customerId: [input.customerId],
			status: ['billed', 'paid', 'completed', 'past_due', 'canceled'],
			orderBy: 'created_at[DESC]',
			perPage: limit,
		});

		// 2. One page is what the caller asked for; the collection would keep paging
		const transactions = await page.next();

		return transactions.slice(0, limit).map(toInvoice);
	}

	/**
	 * Verify a webhook against the destination's secret and normalise its event.
	 *
	 * @param rawBody - The body byte for byte.
	 * @param headers - The request headers, lower-cased.
	 * @returns The event, or `null` for one the kit does not act on.
	 * @throws InvalidPayloadError without the `paddle-signature` header, or for a body that is not a Paddle event.
	 * @throws InvalidCredentialsError when the signature does not verify, or its timestamp is outside the SDK's
	 * tolerance.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// 1. Without a signature header there is nothing to verify against; the delivery is malformed, not forged
		const signature = headers[SIGNATURE_HEADER];

		if (!signature) {
			throw new InvalidPayloadError({ reason: `The delivery carries no ${SIGNATURE_HEADER} header` });
		}

		// 2. The SDK checks the signature before it reads the body; a malformed header is a refused signature too
		if (!(await this.client.webhooks.isSignatureValid(rawBody, this.webhookSecret, signature).catch(() => false))) {
			throw new InvalidCredentialsError();
		}

		// 3. A verified body that is not an event is the sender's problem, reported as such — the SDK reads an unknown
		//    type as a generic event and a non-event as one without a type or an id
		let event;

		try {
			event = await this.client.webhooks.unmarshal(rawBody, this.webhookSecret, signature);
		} catch (error) {
			throw new InvalidPayloadError({ reason: error instanceof Error ? error.message : String(error) });
		}

		if (typeof event.eventType !== 'string' || typeof event.eventId !== 'string') {
			throw new InvalidPayloadError({ reason: 'The body is not a Paddle event' });
		}

		// 4. The mapping decides which Paddle events the kit acts on
		return toEvent(event);
	}

	/**
	 * Prove the key works with the cheapest read there is.
	 *
	 * @throws Paddle's `ApiError` when it does not.
	 */
	async verify(): Promise<void> {
		// 1. The event types need nothing but a valid key and answer the same for every account
		await this.client.eventTypes.list();
	}
}
