import type { LimiterDriver } from '@novastarter/memory';
import { DriverManager } from '@novastarter/utils';
import type { SmsDriver } from '../driver.js';
import { SmsDriverConsole, type SmsDriverConsoleConfig } from './drivers/console.js';

/**
 * SMS drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in one is listed here; each `@novastarter/sms-driver-*` package adds itself with a module augmentation —
 * `declare module '@novastarter/sms' { interface SmsDrivers { twilio: SmsDriverTwilioConfig } }` — so a location's
 * `options` are checked against the driver it names once the package is imported. An application does the same for
 * a driver of its own.
 */
export interface SmsDrivers {
	/** {@link SmsDriverConsole}: writes every message to the log. */
	console: SmsDriverConsoleConfig;
}

/**
 * How `sendSms()` picks a location for a message: the default sender, the chains by category, and the rate limiter
 * of each location.
 *
 * Every field is optional: with none, every message goes down every registered location in registration order, so a
 * single location needs no routes at all.
 */
export interface SmsRoutes {
	/** Sender of every message without a `from` of its own: a number in E.164 or an alphanumeric sender id. */
	from?: string | undefined;
	/** Locations to try, in order, for `transactional` messages. */
	transactional?: string[] | undefined;
	/** Locations to try, in order, for `marketing` messages. */
	marketing?: string[] | undefined;
	/** Rate limiter by location name; a location over its limit is skipped for the next one in the chain. */
	limiters?: Record<string, LimiterDriver> | undefined;
}

/**
 * Registry of named SMS locations and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for SMS: the built-in `console` driver is registered on construction, a vendor
 * driver is registered by the application from its package, and a location — a driver with its options under a name
 * (`main`, `backup`, `bulk`) — is built on its first use, so a single driver can back several accounts and an unused
 * location never opens a client. The routes are what `sendSms()` reads to pick the chain of locations for a message.
 * The application wires it at start-up through {@link useSms}.
 *
 * @example
 * ```ts
 * const sms = new SmsManager();
 *
 * sms.registerDriver('twilio', SmsDriverTwilio);
 * sms.registerLocation('main', {
 * 	driver: 'twilio',
 * 	options: {
 * 		accountSid: 'AC…',
 * 		authToken: '…',
 * 	},
 * });
 * sms.registerRoutes({
 * 	from: '+14155550100',
 * });
 *
 * await sms.location('main').send(message);
 * ```
 */
export class SmsManager extends DriverManager<SmsDriver, SmsDrivers> {
	/**
	 * Routes registered by the application; empty until {@link registerRoutes} runs.
	 *
	 * @internal
	 */
	private smsRoutes: SmsRoutes = {};

	/**
	 * Create the registry with the built-in driver already registered.
	 */
	constructor() {
		super();

		// Registering the package's own driver here spares every application the same line; a replacement under the
		// same name still wins.
		this.registerDriver('console', SmsDriverConsole);
	}

	/**
	 * Register the routes of the process, replacing the previous ones.
	 *
	 * Names in a chain are not checked against the locations here: the chain is filtered on every send, so a location
	 * registered after the routes still takes part.
	 *
	 * @param routes - Sender, chains and limiters; see {@link SmsRoutes}.
	 */
	registerRoutes(routes: SmsRoutes): void {
		// Replace rather than merge, like `registerLocation`: a second bootstrap gets exactly what it registered.
		this.smsRoutes = routes;
	}

	/**
	 * Return the registered routes.
	 *
	 * @returns The routes; an empty object when none were registered.
	 */
	routes(): SmsRoutes {
		// Handed out by reference, not copied: `sendSms()` reads it on every call, so a later `registerRoutes` is seen
		// at once and the limiters keep their identity.
		return this.smsRoutes;
	}
}
