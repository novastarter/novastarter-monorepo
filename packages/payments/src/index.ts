/**
 * Public entry point of `@novastarter/payments`.
 *
 * Billing in three parts: the {@link PaymentsDriver} contract a provider package implements, the
 * {@link PaymentsManager} of {@link usePayments} mapping named locations to those drivers, and
 * {@link handleWebhook}, which verifies a delivery through a location and runs the event through the
 * `payments.webhook` filter. What the application sells — its plans and what they grant — is the application's own.
 */
export * from './driver.js';
export * from './lib/handle-webhook.js';
export * from './lib/payments-manager.js';
export * from './lib/use-payments.js';
export * from './types.js';
