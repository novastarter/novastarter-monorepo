/**
 * Public entry point of `@novastarter/mail-driver-ses`: the {@link MailDriverSes} class, its options, the default
 * deadline of its `call()` and the default export for consumers that import the driver without a named binding.
 */
import { MailDriverSes } from './lib/driver.js';

export { DEFAULT_SES_CALL_TIMEOUT, MailDriverSes, type MailDriverSesConfig } from './lib/driver.js';
export default MailDriverSes;
