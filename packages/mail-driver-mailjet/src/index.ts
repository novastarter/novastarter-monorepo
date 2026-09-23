/**
 * Public entry point of `@novastarter/mail-driver-mailjet`: the {@link MailDriverMailjet} class, its options, the
 * default deadline of its `call()` and the default export for consumers that import the driver without a named binding.
 */
import { MailDriverMailjet } from './lib/driver.js';

export { DEFAULT_MAILJET_CALL_TIMEOUT, MailDriverMailjet, type MailDriverMailjetConfig } from './lib/driver.js';
export default MailDriverMailjet;
