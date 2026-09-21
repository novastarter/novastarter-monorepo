import { type Singleton, singleton } from '@novastarter/utils';
import { MailManager } from './mail-manager.js';

/**
 * Return the process-wide {@link MailManager}, creating one with only the built-in drivers on first use.
 *
 * The application registers its vendor drivers, locations and routes on it at start-up; `sendMail()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call; `useMail.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const mail = useMail();
 *
 * mail.registerDriver('ses', MailDriverSes);
 * mail.registerLocation('main', {
 * 	driver: 'ses',
 * 	options: {
 * 		region: env['MAIL_SES_REGION'],
 * 	},
 * });
 * mail.registerRoutes({
 * 	from: env['MAIL_FROM'],
 * });
 *
 * // anywhere later
 * await sendMail({
 * 	to: user.email,
 * 	subject: 'Welcome',
 * 	html,
 * });
 * ```
 */
export const useMail: Singleton<MailManager> = singleton(() => new MailManager());
