/**
 * Public entry point of `@novastarter/mail-driver-postmark`: the {@link MailDriverPostmark} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { MailDriverPostmark } from './lib/driver.js';

export { DEFAULT_POSTMARK_CALL_TIMEOUT, MailDriverPostmark, type MailDriverPostmarkConfig } from './lib/driver.js';
export default MailDriverPostmark;
