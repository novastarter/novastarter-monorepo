/**
 * Public entry point of `@novastarter/payments-driver-lemonsqueezy`: the {@link PaymentsDriverLemonSqueezy} class, its
 * options, its refusal error {@link LemonSqueezyApiError} — every public method documents it under `@throws`, and
 * consumers need it reachable here to classify refusals — and the default export for consumers that import the driver
 * without a named binding.
 */
import { PaymentsDriverLemonSqueezy } from './lib/driver.js';

export { PaymentsDriverLemonSqueezy, type PaymentsDriverLemonSqueezyConfig } from './lib/driver.js';
export { LemonSqueezyApiError } from './lib/api.js';
export default PaymentsDriverLemonSqueezy;
