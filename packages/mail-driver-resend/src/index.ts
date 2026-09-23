/**
 * Public entry point of `@novastarter/mail-driver-resend`: the {@link MailDriverResend} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { MailDriverResend } from './lib/driver.js';

export { DEFAULT_RESEND_CALL_TIMEOUT, MailDriverResend, type MailDriverResendConfig } from './lib/driver.js';
export default MailDriverResend;
