/**
 * Public entry point of `@novastarter/payments-driver-paddle`: the {@link PaymentsDriverPaddle} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { PaymentsDriverPaddle } from './lib/driver.js';

export { PaymentsDriverPaddle, type PaymentsDriverPaddleConfig } from './lib/driver.js';
export default PaymentsDriverPaddle;
