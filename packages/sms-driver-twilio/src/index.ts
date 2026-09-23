/**
 * Public entry point of `@novastarter/sms-driver-twilio`: the {@link SmsDriverTwilio} class, its options, the
 * default timeout of its `call()` and the default export for consumers that import the driver without a named binding.
 */
import { SmsDriverTwilio } from './lib/driver.js';

export { DEFAULT_TWILIO_CALL_TIMEOUT, SmsDriverTwilio, type SmsDriverTwilioConfig } from './lib/driver.js';
export default SmsDriverTwilio;
