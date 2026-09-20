/**
 * Public entry point of `@novastarter/payments-driver-stripe`.
 *
 * One driver class and its options type; the mappings from `stripe-node`'s objects behind it are the package's own.
 */
import { DriverStripe } from './lib/driver.js';

export { DriverStripe, type DriverStripeConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverStripe;
