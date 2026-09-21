/**
 * Public entry point of `@novastarter/payments-driver-lemonsqueezy`: the {@link PaymentsDriverLemonSqueezy} class, its
 * options and the default export for consumers that import the driver without a named binding.
 */
import { PaymentsDriverLemonSqueezy } from './lib/driver.js';

export { PaymentsDriverLemonSqueezy, type PaymentsDriverLemonSqueezyConfig } from './lib/driver.js';
export default PaymentsDriverLemonSqueezy;
