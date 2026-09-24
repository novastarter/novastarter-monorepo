import { DriverManager } from '@novastarter/utils';
import type { PushDriver } from '../driver.js';
import type { PushPlatform } from '../types.js';
import { PushDriverConsole, type PushDriverConsoleConfig } from './drivers/console.js';

/**
 * Push drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in one is listed here; each `@novastarter/push-driver-*` package adds itself with a module
 * augmentation — `declare module '@novastarter/push' { interface PushDrivers { fcm: PushDriverFcmConfig } }` — so a
 * location's `options` are checked against the driver it names once the package is imported. An application does
 * the same for a driver of its own.
 */
export interface PushDrivers {
	/** {@link PushDriverConsole}: writes every message to the log. */
	console: PushDriverConsoleConfig;
}

/**
 * How `sendPush()` picks a location for a message: the location that serves each platform.
 *
 * A message names its own `location` when the target was registered with a particular one; otherwise the route of
 * the target's platform is used, and without one the location named after the platform (`webpush`, `fcm`, `apns`).
 * There is no chain: a browser subscription only works with the VAPID key pair it was created for, a token only with
 * its Firebase project or its Apple app, so a second location could not take a target the first one refused.
 */
export type PushRoutes = Partial<Record<PushPlatform, string>>;

/**
 * Registry of named push locations and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for push notifications: the built-in `console` driver is registered on
 * construction, a vendor driver is registered by the application from its package, and a location — a driver with
 * its options under a name (`webpush`, `fcm`, `fcm-staging`) — is built on its first use, so a single driver can back
 * several key pairs or Firebase projects and an unused location never opens a client. The routes are what
 * `sendPush()` reads to pick the location for a message's platform. The application wires it at start-up through
 * {@link usePush}.
 *
 * @example
 * ```ts
 * const push = new PushManager();
 *
 * push.registerDriver('webpush', PushDriverWebPush);
 * push.registerLocation('webpush', {
 * 	driver: 'webpush',
 * 	options: {
 * 		publicKey: '…',
 * 		privateKey: '…',
 * 		subject: 'mailto:ops@example.com',
 * 	},
 * });
 * push.registerRoutes({
 * 	webpush: 'webpush',
 * });
 *
 * await push.location('webpush').send(message);
 * ```
 */
export class PushManager extends DriverManager<PushDriver, PushDrivers> {
	/**
	 * Routes registered by the application; empty until {@link registerRoutes} runs.
	 *
	 * @internal
	 */
	private pushRoutes: PushRoutes = {};

	/**
	 * Create the registry with the built-in driver already registered.
	 */
	constructor() {
		super();

		// Registered here to spare every application the same line; a replacement under the same name still wins
		this.registerDriver('console', PushDriverConsole);
	}

	/**
	 * Register the routes of the process, replacing the previous ones.
	 *
	 * Names are not checked against the locations here: the route is resolved on every send, so a location registered
	 * after the routes still takes part.
	 *
	 * @param routes - The location of each platform; see {@link PushRoutes}.
	 */
	registerRoutes(routes: PushRoutes): void {
		// Replace rather than merge, like `registerLocation`: a second bootstrap gets exactly what it registered
		this.pushRoutes = routes;
	}

	/**
	 * Return the registered routes.
	 *
	 * @returns The routes; an empty object when none were registered.
	 */
	routes(): PushRoutes {
		// Not copied: the routes are replaced whole by `registerRoutes()`, never mutated in place
		return this.pushRoutes;
	}
}
