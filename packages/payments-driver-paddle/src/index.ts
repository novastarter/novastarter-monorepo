/**
 * Public entry point of `@novastarter/payments-driver-paddle`.
 *
 * One driver class and its options type; the mappings from `@paddle/paddle-node-sdk`'s entities behind it are the
 * package's own.
 */
import { DriverPaddle } from './lib/driver.js';

export { DriverPaddle, type DriverPaddleConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverPaddle;
