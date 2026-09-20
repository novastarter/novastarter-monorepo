/**
 * Public entry point of `@novastarter/payments-driver-polar`.
 *
 * One driver class and its options type; the mappings from `@polar-sh/sdk`'s models behind it are the package's own.
 */
import { DriverPolar } from './lib/driver.js';

export { DriverPolar, type DriverPolarConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverPolar;
