/**
 * Public entry point of `@novastarter/payments`.
 *
 * Billing in two parts: the {@link PaymentsDriver} contract a provider package implements, and the
 * {@link PaymentsManager} of {@link usePayments} mapping named locations to those drivers. What the application
 * sells — its plans and what they grant — is the application's own.
 */
export * from './driver.js';
export * from './lib/payments-manager.js';
export * from './lib/use-payments.js';
export * from './types.js';
