/**
 * Public entry point of `@novastarter/sms-driver-vonage`: the {@link SmsDriverVonage} class, its options, its error
 * classes and the default export for consumers that import the driver without a named binding.
 */
import { SmsDriverVonage } from './lib/driver.js';

export { SmsPartialDeliveryError, type SmsPartialDeliveryErrorExtensions } from './lib/errors/index.js';
export { SmsDriverVonage, type SmsDriverVonageConfig } from './lib/driver.js';
export default SmsDriverVonage;
