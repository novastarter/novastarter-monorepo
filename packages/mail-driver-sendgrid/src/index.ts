/**
 * Public entry point of `@novastarter/mail-driver-sendgrid`: the {@link MailDriverSendgrid} class, its options and the default export
 * for consumers that import the driver without a named binding.
 */
import { MailDriverSendgrid } from './lib/driver.js';

export { MailDriverSendgrid, type MailDriverSendgridConfig } from './lib/driver.js';
export default MailDriverSendgrid;
