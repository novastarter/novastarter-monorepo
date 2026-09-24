/**
 * Public entry point of `@novastarter/payments-driver-lemonsqueezy`: the {@link PaymentsDriverLemonSqueezy} class, its
 * options and its refusal error {@link LemonSqueezyApiError} — every public method documents it under `@throws`, and
 * consumers need it reachable here to classify refusals.
 */
export { PaymentsDriverLemonSqueezy, type PaymentsDriverLemonSqueezyConfig } from './lib/driver.js';
export { LemonSqueezyApiError } from './lib/api.js';
