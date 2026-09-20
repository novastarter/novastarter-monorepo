/**
 * Public entry point of `@novastarter/payments-driver-paddle`.
 *
 * One driver class and its options type; the mappings from `@paddle/paddle-node-sdk`'s entities behind it are the
 * package's own.
 */
import { PaymentsDriverPaddle } from './lib/driver.js';

export { PaymentsDriverPaddle, type PaymentsDriverPaddleConfig } from './lib/driver.js';

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PaymentsDriverPaddle;
