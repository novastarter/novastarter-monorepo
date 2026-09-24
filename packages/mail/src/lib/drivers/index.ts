/**
 * The built-in mail drivers: `console` and `file` for development, `sendmail` and `smtp` for delivery.
 */
export { MailDriverConsole, type MailDriverConsoleConfig } from './console.js';
export { MailDriverFile, type MailDriverFileConfig } from './file.js';
export { MailDriverSendmail, type MailDriverSendmailConfig } from './sendmail.js';
export { MailDriverSmtp, type MailDriverSmtpConfig } from './smtp.js';
