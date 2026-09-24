/**
 * Public entry point of `@novastarter/mail`.
 *
 * Outgoing mail in three parts: the {@link MailDriver} contract with the built-in `console`, `file`, `sendmail` and
 * `smtp` drivers (vendor SDKs live in the `@novastarter/mail-driver-*` packages), the {@link MailManager} of
 * {@link useMail} mapping named locations to drivers and holding the routes the application registers at start-up,
 * and {@link sendMail}, which fills the defaults in and routes a message down a chain of locations.
 */
export type { MailDriver } from './driver.js';
export {
	MailDriverConsole,
	type MailDriverConsoleConfig,
	MailDriverFile,
	type MailDriverFileConfig,
	MailDriverSendmail,
	type MailDriverSendmailConfig,
	MailDriverSmtp,
	type MailDriverSmtpConfig,
} from './lib/drivers/index.js';
export { bareMailAddress, formatMailAddress, parseMailAddress, toMailAddressList } from './lib/format-address.js';
export { MailManager, type MailDrivers, type MailRoutes } from './lib/mail-manager.js';
export { readAttachment } from './lib/read-attachment.js';
export { addressDomain, resolveMailChain } from './lib/router.js';
export {
	MAIL_FAILED_EVENT,
	MAIL_SEND_FILTER,
	MAIL_SENT_EVENT,
	type MailSendOptions,
	type MailSendResult,
	normalizeHtml,
	sendMail,
} from './lib/send-mail.js';
export { type NodemailerInfo, toMailResult } from './lib/to-mail-result.js';
export { toNodemailerAddress, toNodemailerMessage } from './lib/to-nodemailer-message.js';
export { useMail } from './lib/use-mail.js';
export type { MailAddress, MailAttachment, MailCategory, MailMessage, MailResult } from './types.js';
