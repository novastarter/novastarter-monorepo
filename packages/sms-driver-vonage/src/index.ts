/**
 * Public entry point of `@novastarter/sms-driver-vonage`: the {@link SmsDriverVonage} class, its options, the
 * default timeout of its `call()` and the default export for consumers that import the driver without a named binding.
 */
import { SmsDriverVonage } from './lib/driver.js';

export { DEFAULT_VONAGE_CALL_TIMEOUT } from './lib/constants.js';
export { SmsDriverVonage, type SmsDriverVonageConfig } from './lib/driver.js';
export default SmsDriverVonage;
