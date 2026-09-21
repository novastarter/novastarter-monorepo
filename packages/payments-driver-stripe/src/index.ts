/**
 * Public entry point of `@novastarter/payments-driver-stripe`: the {@link PaymentsDriverStripe} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { PaymentsDriverStripe } from './lib/driver.js';

export { PaymentsDriverStripe, type PaymentsDriverStripeConfig } from './lib/driver.js';
export default PaymentsDriverStripe;
