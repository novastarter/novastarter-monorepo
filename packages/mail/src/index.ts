/**
 * Public entry point of `@novastarter/mail`.
 *
 * Outgoing mail in three parts: the {@link MailDriver} contract with the built-in `console`, `file`, `sendmail` and
 * `smtp` drivers (vendor SDKs live in the `@novastarter/mail-driver-*` packages), the {@link MailManager} of
 * {@link useMail} mapping named locations to drivers and holding the routes the application registers at start-up,
 * and {@link sendMail}, which fills the defaults in and routes a message down a chain of locations.
 */
export * from './driver.js';
export * from './lib/drivers/index.js';
export * from './lib/format-address.js';
export * from './lib/mail-manager.js';
export * from './lib/read-attachment.js';
export * from './lib/router.js';
export * from './lib/send-mail.js';
export * from './lib/to-mail-result.js';
export * from './lib/to-nodemailer-message.js';
export * from './lib/use-mail.js';
export * from './types.js';
