import { MailManager } from './mail-manager.js';

/**
 * The manager of the process.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 */
export const _cache: { mail: MailManager | undefined } = { mail: undefined };

/**
 * Return the process-wide {@link MailManager}, creating one with only the built-in drivers on first use.
 *
 * The application registers its vendor drivers, locations and routes on it at start-up; `sendMail()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call.
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
export const useMail = (): MailManager => {
	// 1. One manager per process: a second one would build every location, and its connections, again
	if (_cache.mail) {
		return _cache.mail;
	}

	_cache.mail = new MailManager();

	return _cache.mail;
};
