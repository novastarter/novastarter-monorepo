/**
 * Public entry point of `@novastarter/payments`.
 *
 * Billing in three parts: the {@link PaymentsDriver} contract a provider package implements, the
 * {@link PaymentsManager} of {@link usePayments} mapping named locations to those drivers, and
 * {@link handleWebhook}, which verifies a delivery through a location and runs the event through the
 * `payments.webhook` filter. What the application sells — its plans and what they grant — is the application's own.
 */
export type { PaymentsDriver } from './driver.js';
export {
	handleWebhook,
	PAYMENTS_FAILED_EVENT,
	PAYMENTS_RECEIVED_EVENT,
	PAYMENTS_WEBHOOK_FILTER,
	type PaymentsWebhookOptions,
} from './lib/handle-webhook.js';
export { type PaymentsDrivers, PaymentsManager } from './lib/payments-manager.js';
export { usePayments } from './lib/use-payments.js';
export type {
	BillingInterval,
	CancelSubscriptionInput,
	CheckoutSession,
	CompletedCheckout,
	CreateCheckoutSessionInput,
	CreateCustomerInput,
	CreatePortalSessionInput,
	Invoice,
	InvoiceStatus,
	ListInvoicesInput,
	Money,
	PaymentsCustomer,
	PaymentsEvent,
	PaymentsEventBase,
	PaymentsEventType,
	PortalSession,
	Subscription,
	SubscriptionStatus,
	UpdateSubscriptionInput,
	WebhookHeaders,
} from './types.js';
