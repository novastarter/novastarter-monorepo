/**
 * Public entry point of `@novastarter/payments-driver-lemonsqueezy`.
 *
 * One driver class and its options type; the JSON:API client and the mappings behind it are the package's own.
 */
import { DriverLemonSqueezy } from './lib/driver.js';

export { DriverLemonSqueezy, type DriverLemonSqueezyConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverLemonSqueezy;
