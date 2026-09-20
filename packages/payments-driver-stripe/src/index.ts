/**
 * Public entry point of `@novastarter/payments-driver-stripe`.
 *
 * One driver class and its options type; the mappings from `stripe-node`'s objects behind it are the package's own.
 */
import { PaymentsDriverStripe } from './lib/driver.js';

export { PaymentsDriverStripe, type PaymentsDriverStripeConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PaymentsDriverStripe;
