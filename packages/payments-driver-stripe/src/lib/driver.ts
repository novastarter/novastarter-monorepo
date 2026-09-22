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
import Stripe from 'stripe';
import { fromUnix } from './from-unix.js';
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
	 * The `stripe-node` client every request goes through.
	 *
	 * @internal
	 */
	private readonly client: Stripe;

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
	 * the new price and quantity, and Stripe prorates as told.
	 *
	 * @param input - Subscription, new price and/or seats, proration.
	 * @returns The subscription after the change.
	 * @throws Error when neither a price nor a seat count is given.
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

		// 3. One update carries both changes; Stripe prorates the way the caller chose, `prorate` unless told
		const updated = await this.client.subscriptions.update(input.subscriptionId, {
			items: [
				{
					id: item.id,
					...(input.priceId !== undefined ? { price: input.priceId } : {}),
					...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
				},
			],
			proration_behavior: PRORATION[input.proration ?? 'prorate'],
		});

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
