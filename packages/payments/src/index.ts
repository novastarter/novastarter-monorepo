/**
 * Public entry point of `@novastarter/payments`.
 *
 * Billing in three parts: the {@link PaymentsDriver} contract a provider package implements, the
 * {@link PaymentsManager} of {@link usePayments} mapping named locations to those drivers, and the plan catalog of
 * {@link definePlans} with the {@link EntitlementManager} that gates features by it.
 */
export * from './driver.js';
export * from './lib/entitlements.js';
export * from './lib/payments-manager.js';
export * from './lib/plan-catalog.js';
export * from './lib/use-payments.js';
export * from './plans.js';
export * from './types.js';
