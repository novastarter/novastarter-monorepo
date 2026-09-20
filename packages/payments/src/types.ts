/**
 * The lifecycle states of a subscription — the set Stripe and Polar share, so a driver maps its provider's status onto
 * one of these and the app never sees a provider's own vocabulary.
 *
 * - `incomplete` / `incomplete_expired` — the first payment did not go through (yet / at all).
 * - `trialing` — in a free trial; `active` — paid up.
 * - `past_due` — a renewal failed and is being retried; `unpaid` — the retries ran out.
 * - `paused` — kept on file without billing; `canceled` — over.
 */
export type SubscriptionStatus =
	'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';

/**
 * How often a recurring price is charged.
 */
export type BillingInterval = 'day' | 'week' | 'month' | 'year';

/**
 * An amount of money as the providers report it: minor units (cents) of an ISO 4217 currency in lower case.
 */
export interface Money {
	/** Minor units — `1999` is $19.99. */
	amount: number;
	/** ISO 4217 code, lower case: `usd`, `eur`. */
	currency: string;
}

/**
 * A billing customer on the provider's side — one per organization of the app.
 */
export interface PaymentsCustomer {
	/** The provider's id (`cus_…` on Stripe). */
	id: string;
	email: string;
	name: string | null;
	/** Free-form strings the provider stores with the customer; the app keeps its organization id here. */
	metadata: Record<string, string>;
}

/**
 * What {@link PaymentsDriver.createCustomer} takes.
 */
export interface CreateCustomerInput {
	email: string;
	name?: string | undefined;
	/** Stored with the customer; the app's organization id at least, so a webhook can be traced back. */
	metadata?: Record<string, string> | undefined;
}

/**
 * What {@link PaymentsDriver.createCheckoutSession} takes: who buys what, and where the browser goes afterwards.
 */
export interface CreateCheckoutSessionInput {
	/** The customer the subscription belongs to — created first with `createCustomer()`. */
	customerId: string;
	/** The provider's id of the price (a Stripe price, a Polar product), as the application's plans record it. */
	priceId: string;
	/** Seats, for prices charged per unit. */
	quantity?: number | undefined;
	/** Where the provider sends the browser after a successful payment. */
	successUrl: string;
	/** Where the provider sends the browser when the customer backs out. */
	cancelUrl: string;
	/** Days of free trial before the first charge; none unless given. */
	trialDays?: number | undefined;
	/** Whether the customer may enter a promotion code on the provider's page. */
	allowPromotionCodes?: boolean | undefined;
	/** Copied onto the subscription the checkout creates — the plan id, the organization id — so the webhook that
	 * announces the subscription carries them. */
	metadata?: Record<string, string> | undefined;
}

/**
 * A hosted checkout page the browser is sent to.
 */
export interface CheckoutSession {
	/** The provider's id of the session. */
	id: string;
	/** The page to redirect to. */
	url: string;
	/** When the provider stops accepting the session; `null` when it does not say. */
	expiresAt: Date | null;
}

/**
 * What {@link PaymentsDriver.createPortalSession} takes.
 */
export interface CreatePortalSessionInput {
	customerId: string;
	/** Where the portal's "back" link leads. */
	returnUrl: string;
}

/**
 * The provider's self-service portal — payment methods, invoices, cancellation — for one customer.
 */
export interface PortalSession {
	url: string;
}

/**
 * A subscription as the app sees it, whichever provider holds it.
 */
export interface Subscription {
	/** The provider's id (`sub_…` on Stripe). */
	id: string;
	customerId: string;
	status: SubscriptionStatus;
	/** The provider's id of the price being paid — what the application maps back to one of its plans. */
	priceId: string;
	/** The provider's id of the product the price belongs to; `null` when the provider has no such notion. */
	productId: string | null;
	/** Seats. */
	quantity: number;
	interval: BillingInterval;
	/** The billing period being paid for; `null` before the first invoice settles it. */
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	/** Whether the customer asked to stop at the end of the current period. */
	cancelAtPeriodEnd: boolean;
	/** When the subscription is scheduled to end, if it is. */
	cancelAt: Date | null;
	/** When the cancellation was requested. */
	canceledAt: Date | null;
	/** When the trial ends or ended; `null` without one. */
	trialEnd: Date | null;
	/** When the subscription actually ended; `null` while it runs. */
	endedAt: Date | null;
	/** The strings the checkout put here: the plan id, the organization id. */
	metadata: Record<string, string>;
}

/**
 * What {@link PaymentsDriver.updateSubscription} takes: a new price (plan change), a new seat count, or both.
 */
export interface UpdateSubscriptionInput {
	subscriptionId: string;
	/** The provider's id of the price to switch to. */
	priceId?: string | undefined;
	/** The new seat count. */
	quantity?: number | undefined;
	/** How the difference is charged: right away, on the next invoice, or not at all. `prorate` unless given. */
	proration?: 'prorate' | 'none' | 'invoice' | undefined;
}

/**
 * What {@link PaymentsDriver.cancelSubscription} takes.
 */
export interface CancelSubscriptionInput {
	subscriptionId: string;
	/** Stop now rather than at the end of the paid period. Off unless given: the customer keeps what was paid for. */
	immediately?: boolean | undefined;
	/** Why, as told by the customer; passed to the provider when it records reasons. */
	reason?: string | undefined;
}

/**
 * Where an invoice stands.
 */
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

/**
 * An invoice — or, on a provider without invoices, the order that stands for one.
 */
export interface Invoice {
	/** The provider's id. */
	id: string;
	/** The number printed on the invoice; `null` while it is a draft. */
	number: string | null;
	customerId: string;
	subscriptionId: string | null;
	status: InvoiceStatus;
	total: Money;
	/** Minor units already paid. */
	amountPaid: number;
	/** Minor units still owed. */
	amountDue: number;
	createdAt: Date;
	dueAt: Date | null;
	paidAt: Date | null;
	/** The provider's page for this invoice, when there is one. */
	hostedUrl: string | null;
	/** A PDF to download, when there is one. */
	pdfUrl: string | null;
}

/**
 * What {@link PaymentsDriver.listInvoices} takes.
 */
export interface ListInvoicesInput {
	customerId: string;
	/** Most recent first; the driver's default when not given. */
	limit?: number | undefined;
}

/**
 * The request headers a webhook arrives with, lower-cased names; the driver reads its signature header from them.
 */
export type WebhookHeaders = Record<string, string | undefined>;

/**
 * The events the app acts on. A driver maps its provider's own event names onto these; anything else it verifies and
 * drops (`parseWebhook()` answers `null`).
 */
export type PaymentsEventType =
	| 'checkout.completed'
	| 'subscription.created'
	| 'subscription.updated'
	| 'subscription.deleted'
	| 'invoice.paid'
	| 'invoice.failed';

/**
 * What every event carries.
 *
 * @typeParam Type - The event's type.
 */
export interface PaymentsEventBase<Type extends PaymentsEventType = PaymentsEventType> {
	/** The provider's event id — the key of the idempotency guard: an event delivered twice is applied once. */
	id: string;
	type: Type;
	/** The driver that produced the event: `stripe`, `polar`. */
	provider: string;
	/** When the provider says it happened. */
	occurredAt: Date;
	/** The provider's own payload, verified, for the audit trail and for what the normalised shape leaves out. */
	raw: unknown;
}

/**
 * A finished checkout: the customer paid, and the provider created the subscription (or will announce it next).
 */
export interface CompletedCheckout {
	/** The checkout session's id. */
	id: string;
	customerId: string;
	/** The subscription the checkout created; `null` when the provider announces it in a later event. */
	subscriptionId: string | null;
	/** What the checkout was started with. */
	metadata: Record<string, string>;
}

/**
 * A normalised webhook event: what happened, and the object it happened to.
 */
export type PaymentsEvent =
	| (PaymentsEventBase<'checkout.completed'> & { checkout: CompletedCheckout })
	| (PaymentsEventBase<'subscription.created' | 'subscription.updated' | 'subscription.deleted'> & {
			subscription: Subscription;
	  })
	| (PaymentsEventBase<'invoice.paid' | 'invoice.failed'> & { invoice: Invoice });
