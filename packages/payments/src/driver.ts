import type {
	CancelSubscriptionInput,
	CheckoutSession,
	CreateCheckoutSessionInput,
	CreateCustomerInput,
	CreatePortalSessionInput,
	Invoice,
	ListInvoicesInput,
	PaymentsCustomer,
	PaymentsEvent,
	PortalSession,
	Subscription,
	UpdateSubscriptionInput,
	WebhookHeaders,
} from './types.js';

/**
 * Contract every payments driver implements.
 *
 * Declared as an ambient class rather than an interface so that `typeof PaymentsDriver` describes a constructor for
 * {@link PaymentsManager.registerDriver}; no runtime code exists behind it. The drivers speak to a vendor's API and
 * live in `@novastarter/payments-driver-*` packages. Every method answers the normalised shapes of `types.ts`, so the
 * app's billing module reads the same subscription and the same events whichever provider is behind a location.
 */
export declare class PaymentsDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Create the provider's customer for an organization — once, before its first checkout.
	 *
	 * @param input - Email, name and the metadata that ties the customer to the organization.
	 * @returns The customer, with the provider's id to store.
	 * @throws When the provider refuses or cannot be reached.
	 */
	createCustomer(input: CreateCustomerInput): Promise<PaymentsCustomer>;

	/**
	 * Start a hosted checkout for a price; the browser is redirected to its `url` and comes back to `successUrl` or
	 * `cancelUrl`.
	 *
	 * @param input - Customer, price, seats, redirect targets, trial and metadata.
	 * @returns The session and its page.
	 * @throws When the provider refuses or cannot be reached.
	 */
	createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;

	/**
	 * Open the provider's self-service portal for a customer.
	 *
	 * @param input - Customer and where the portal leads back to.
	 * @returns The portal page.
	 * @throws When the provider refuses or cannot be reached.
	 */
	createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession>;

	/**
	 * Read a subscription as the provider currently holds it.
	 *
	 * @param subscriptionId - The provider's id.
	 * @returns The subscription, normalised.
	 * @throws When there is no such subscription, or the provider cannot be reached.
	 */
	getSubscription(subscriptionId: string): Promise<Subscription>;

	/**
	 * Change a subscription's price (plan) or seat count.
	 *
	 * @param input - What to change and how to charge the difference.
	 * @returns The subscription after the change.
	 * @throws When the provider refuses — an unknown price, a seat count below the minimum — or cannot be reached.
	 */
	updateSubscription(input: UpdateSubscriptionInput): Promise<Subscription>;

	/**
	 * Cancel a subscription: at the end of the paid period, or right away.
	 *
	 * @param input - Which subscription, when, and why.
	 * @returns The subscription after the request — `cancelAtPeriodEnd` set, or `status: 'canceled'`.
	 * @throws When there is no such subscription, or the provider cannot be reached.
	 */
	cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription>;

	/**
	 * The invoices of a customer, most recent first.
	 *
	 * @param input - Customer and how many.
	 * @returns The invoices, normalised.
	 * @throws When the provider cannot be reached.
	 */
	listInvoices(input: ListInvoicesInput): Promise<Invoice[]>;

	/**
	 * Verify a webhook delivery and turn it into an event the app understands.
	 *
	 * The body is checked against the location's webhook secret before anything is read from it. A verified event of
	 * a type the kit does not track answers `null`: the route acknowledges it and moves on. A route calls
	 * `handleWebhook()` of this package rather than the driver, so the event is reported and filtered on the way.
	 *
	 * @param rawBody - The request body byte for byte, as the signature covers it.
	 * @param headers - The request headers, lower-cased names.
	 * @returns The normalised event, or `null` for a verified event of no interest.
	 * @throws InvalidPayloadError (400) when the signature header is missing or the body is not the provider's event.
	 * @throws InvalidCredentialsError (401) when the signature does not verify against the secret.
	 */
	parseWebhook(rawBody: string, headers: WebhookHeaders): Promise<PaymentsEvent | null>;

	/**
	 * Check the credentials work — a cheap read against the provider — without changing anything.
	 *
	 * @throws When they do not.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds — an SDK's HTTP agents — so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
