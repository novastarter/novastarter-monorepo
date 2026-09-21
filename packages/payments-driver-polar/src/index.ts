/**
 * Public entry point of `@novastarter/payments-driver-polar`: the {@link PaymentsDriverPolar} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { PaymentsDriverPolar } from './lib/driver.js';

export { PaymentsDriverPolar, type PaymentsDriverPolarConfig } from './lib/driver.js';
export default PaymentsDriverPolar;
