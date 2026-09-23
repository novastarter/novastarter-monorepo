/**
 * Public entry point of `@novastarter/sms-driver-twilio`: the {@link SmsDriverTwilio} class, its options, the type of
 * its SDK `client` and the default export for consumers that import the driver without a named binding.
 */
import { SmsDriverTwilio } from './lib/driver.js';

export { SmsDriverTwilio, type SmsDriverTwilioConfig, type TwilioClient } from './lib/driver.js';
export default SmsDriverTwilio;
