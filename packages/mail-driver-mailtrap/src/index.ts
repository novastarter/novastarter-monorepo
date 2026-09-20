/**
 * Public entry point of `@novastarter/mail-driver-mailtrap`: the {@link MailDriverMailtrap} class, its options and the default export
 * for consumers that import the driver without a named binding.
 */
import { MailDriverMailtrap } from './lib/driver.js';

export { MailDriverMailtrap, type MailDriverMailtrapConfig } from './lib/driver.js';
export default MailDriverMailtrap;
