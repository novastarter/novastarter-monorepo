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
 * Driver for [Polar](https://polar.sh): hosted checkout, the customer portal, subscriptions and orders over
 * `@polar-sh/sdk`, webhooks verified with the endpoint's secret.
 *
 * Polar is a merchant of record: it sells products (the catalog's `providerIds.polar` are product ids) and issues
 * orders where Stripe issues invoices.
 *
 * @example
 * ```ts
 * usePayments().registerDriver('polar', PaymentsDriverPolar);
 * usePayments().registerLocation('default', {
 * 	driver: 'polar',
 * 	options: {
 * 		accessToken: env['PAYMENTS_POLAR_ACCESS_TOKEN'],
 * 		webhookSecret: env['PAYMENTS_POLAR_WEBHOOK_SECRET'],
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
	 * Create a driver from its location options.
	 *
	 * @param config - Access token, webhook secret, environment.
	 * @throws Error without a token or a webhook secret — a deployment that cannot verify webhooks would drift from
	 * Polar silently.
	 */
	constructor(config: PaymentsDriverPolarConfig) {
		// 1. Fail at registration for the two values nothing works without, rather than on the first request
		if (!config.accessToken) {
			throw new Error('The polar payments driver needs an "accessToken"');
		}

		if (!config.webhookSecret) {
			throw new Error('The polar payments driver needs a "webhookSecret"');
		}

		// 2. The SDK's client for the chosen server; the sandbox has its own tokens and products
		this.client =
			config.client ??
			new Polar({
				accessToken: config.accessToken,
				server: config.server ?? 'production',
			});

		this.webhookSecret = config.webhookSecret;
	}

	/**
	 * Create the Polar customer for an organization.
	 *
	 * @param input - Email, name, metadata.
	 * @returns The customer.
	 */
	async createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer> {
		// 1. Optional fields are only sent when given, so Polar keeps its defaults otherwise
		const customer = await this.client.customers.create({
			email: input.email,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});

		// 2. Polar's metadata may hold numbers and booleans; the kit's is flat strings
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
	 * The trial is expressed in days; the metadata goes on the checkout, and Polar copies it onto the subscription
	 * it creates.
	 *
	 * @param input - Customer, product, seats, redirects, trial, metadata.
	 * @returns The checkout and its page.
	 */
	async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
		// 1. One product per checkout; the trial is expressed in days and the cancel URL is Polar's return URL
		const checkout = await this.client.checkouts.create({
			products: [input.priceId],
			customerId: input.customerId,
			successUrl: input.successUrl,
			returnUrl: input.cancelUrl,
			...(input.quantity !== undefined ? { seats: input.quantity } : {}),
			...(input.allowPromotionCodes !== undefined ? { allowDiscountCodes: input.allowPromotionCodes } : {}),
			...(input.trialDays !== undefined && input.trialDays > 0
				? { trialInterval: 'day' as const, trialIntervalCount: input.trialDays }
				: {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});

		// 2. The hosted page and when Polar stops honouring it
		return { id: checkout.id, url: checkout.url, expiresAt: checkout.expiresAt };
	}

	/**
	 * Open the customer portal through a customer session.
	 *
	 * @param input - Customer and return URL.
	 * @returns The portal page.
	 */
	async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
		// 1. A customer session is what opens the portal; the URL is all the caller needs
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
	 */
	async getSubscription(subscriptionId: string): Promise<Subscription> {
		// 1. The model carries the product and the periods, which is all the mapping reads
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
	 * @throws Error when neither a price nor a seat count is given.
	 */
	async updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription> {
		const prorationBehavior = PRORATION[input.proration ?? 'prorate'];
		let subscription;

		// 1. A product change is one update
		if (input.priceId !== undefined) {
			subscription = await this.client.subscriptions.update({
				id: input.subscriptionId,
				subscriptionUpdate: { productId: input.priceId, prorationBehavior },
			});
		}

		// 2. A seat change is another; its result is the later state, so it is the one returned
		if (input.quantity !== undefined) {
			subscription = await this.client.subscriptions.update({
				id: input.subscriptionId,
				subscriptionUpdate: { seats: input.quantity, prorationBehavior },
			});
		}

		// 3. Neither given: a caller's mistake, reported rather than answered with an unchanged subscription
		if (!subscription) {
			throw new Error(
				`Nothing to update on Polar subscription "${input.subscriptionId}": give a priceId or a quantity`,
			);
		}

		return toSubscription(subscription);
	}

	/**
	 * Cancel a subscription: at the end of the period, or right away (`revoke`).
	 *
	 * @param input - Subscription, when, why.
	 * @returns The subscription after the request.
	 */
	async cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
		// 1. The reason is recorded on Polar's side either way, as the customer's cancellation comment
		const comment = input.reason !== undefined ? { customerCancellationComment: input.reason } : {};

		// 2. Right away is a revoke; at period end is a flag on the subscription
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
	 */
	async listInvoices(input: ListInvoicesInput): Promise<Invoice[]> {
		// 1. Newest first, one page; the limit is passed through when given
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
	 * @throws InvalidPayloadError without the Standard Webhooks headers, or for a body that is not a Polar event.
	 * @throws InvalidCredentialsError when the signature does not verify, or the timestamp is outside the tolerance.
	 */
	async parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null> {
		// 1. All three Standard Webhooks headers have to be there; a missing one is a malformed delivery, not a forged one
		const present: Record<string, string> = {};

		for (const name of WEBHOOK_HEADERS) {
			const value = headers[name];

			if (!value) {
				throw new InvalidPayloadError({ reason: `The delivery carries no ${name} header` });
			}

			present[name] = value;
		}

		// 2. The SDK verifies the signature and the timestamp, then parses the body — in that order
		try {
			return toEvent(validateEvent(rawBody, present, this.webhookSecret), deliveryIdOf(present) ?? '');
		} catch (error) {
			// 3. A signature that does not match, or a stale timestamp, is a credentials problem
			if (error instanceof WebhookVerificationError) {
				throw new InvalidCredentialsError();
			}

			// 4. The SDK verifies before it parses, so a validation error here is a verified event this SDK cannot
			//    read: a type it does not know yet is dropped, a body that is not an event at all is refused
			if (error instanceof SDKValidationError) {
				if (isEventLike(rawBody)) return null;

				throw new InvalidPayloadError({ reason: error.message });
			}

			throw error;
		}
	}

	/**
	 * Prove the token works with the cheapest read there is.
	 *
	 * @throws Polar's authentication error when it does not.
	 */
	async verify(): Promise<void> {
		// 1. One customer is the smallest authenticated read; an invalid token fails here with Polar's own error
		await this.client.customers.list({ limit: 1 });
	}
}

/**
 * Whether a body is a JSON object with a `type` — the shape of every Polar event, known to this SDK or not.
 *
 * @param rawBody - The body text.
 * @returns `true` for an event-shaped body.
 */
const isEventLike = (rawBody: string): boolean => {
	// 1. A body that is not JSON, or not an object with a string `type`, is not an event of any version
	try {
		const parsed: unknown = JSON.parse(rawBody);

		return typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string';
	} catch {
		return false;
	}
};
