import type { LimiterDriver } from '@novastarter/memory';
import { DriverManager } from '@novastarter/utils';
import type { MailDriver } from '../driver.js';
import type { MailAddress } from '../types.js';
import { MailDriverConsole, type MailDriverConsoleConfig } from './drivers/console.js';
import { MailDriverFile, type MailDriverFileConfig } from './drivers/file.js';
import { MailDriverSendmail, type MailDriverSendmailConfig } from './drivers/sendmail.js';
import { MailDriverSmtp, type MailDriverSmtpConfig } from './drivers/smtp.js';

/**
 * Mail drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; each `@novastarter/mail-driver-*` package adds itself with a module
 * augmentation — `declare module '@novastarter/mail' { interface MailDrivers { ses: MailDriverSesConfig } }` — so a
 * location's `options` are checked against the driver it names once the package is imported. An application does
 * the same for a driver of its own.
 */
export interface MailDrivers {
	/** {@link MailDriverConsole}: writes every message to the log. */
	console: MailDriverConsoleConfig;
	/** {@link MailDriverFile}: writes every message as an `.eml` file. */
	file: MailDriverFileConfig;
	/** {@link MailDriverSendmail}: pipes messages to the local `sendmail` binary. */
	sendmail: MailDriverSendmailConfig;
	/** {@link MailDriverSmtp}: any SMTP server through nodemailer. */
	smtp: MailDriverSmtpConfig;
}

/**
 * How `sendMail()` picks a location for a message: the default sender, the chains by category and by sender domain,
 * and the rate limiter of each location.
 *
 * Every field is optional: with none, every message goes down every registered location in registration order, so a
 * single location needs no routes at all.
 */
export interface MailRoutes {
	/** Sender of every message without a `from` of its own. */
	from?: MailAddress | undefined;
	/** Locations to try, in order, for `transactional` mail. */
	transactional?: string[] | undefined;
	/** Locations to try, in order, for `marketing` mail. */
	marketing?: string[] | undefined;
	/** Locations to try, in order, by the sender's domain (lower-cased, e.g. `news.acme.com`); wins over the category. */
	domains?: Record<string, string[]> | undefined;
	/** Rate limiter by location name; a location over its limit is skipped for the next one in the chain. */
	limiters?: Record<string, LimiterDriver> | undefined;
}

/**
 * Registry of named mail locations and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for mail: the built-in drivers (`console`, `file`, `sendmail`, `smtp`) are
 * registered on construction, a vendor driver is registered by the application from its package, and a location — a
 * driver with its options under a name (`main`, `backup`, `bulk`) — is built on its first use, so a single driver can
 * back several accounts and an unused location never opens a client. The routes are what `sendMail()` reads to pick
 * the chain of locations for a message. The application wires it at start-up through {@link useMail}.
 *
 * @example
 * ```ts
 * const mail = new MailManager();
 *
 * mail.registerLocation('main', {
 * 	driver: 'smtp',
 * 	options: {
 * 		host: 'smtp.example.com',
 * 		port: 587,
 * 	},
 * });
 * mail.registerRoutes({
 * 	from: 'no-reply@example.com',
 * });
 *
 * await mail.location('main').send(message);
 * ```
 */
export class MailManager extends DriverManager<MailDriver, MailDrivers> {
	/**
	 * Routes registered by the application; empty until {@link registerRoutes} runs.
	 *
	 * @internal
	 */
	private mailRoutes: MailRoutes = {};

	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// The drivers of the package are known up front; registering them here spares every application the same lines,
		// and a replacement under the same name still wins
		this.registerDriver('console', MailDriverConsole);
		this.registerDriver('file', MailDriverFile);
		this.registerDriver('sendmail', MailDriverSendmail);
		this.registerDriver('smtp', MailDriverSmtp);
	}

	/**
	 * Register the routes of the process, replacing the previous ones.
	 *
	 * Names in a chain are not checked against the locations here: the chain is filtered on every send, so a location
	 * registered after the routes still takes part.
	 *
	 * @param routes - Sender, chains and limiters; see {@link MailRoutes}.
	 */
	registerRoutes(routes: MailRoutes): void {
		// Replace rather than merge, like `registerLocation`: a second bootstrap gets exactly what it registered
		this.mailRoutes = routes;
	}

	/**
	 * Return the registered routes.
	 *
	 * @returns The routes; an empty object when none were registered.
	 */
	routes(): MailRoutes {
		// Handed out by reference, not copied: `sendMail()` reads it on every call, so a later `registerRoutes` is seen
		// at once and the limiters keep their identity
		return this.mailRoutes;
	}
}
