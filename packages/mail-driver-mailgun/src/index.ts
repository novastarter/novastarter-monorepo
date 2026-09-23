/**
 * Public entry point of `@novastarter/mail-driver-mailgun`: the {@link MailDriverMailgun} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { MailDriverMailgun } from './lib/driver.js';

export { DEFAULT_MAILGUN_CALL_TIMEOUT } from './lib/constants.js';
export { MailDriverMailgun, type MailDriverMailgunConfig } from './lib/driver.js';
export default MailDriverMailgun;
