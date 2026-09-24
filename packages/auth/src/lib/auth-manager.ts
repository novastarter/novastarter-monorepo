import { DriverManager } from '@novastarter/utils';
import type { AuthDriver } from '../providers/driver.js';
import type { AuthSettings } from './settings.js';

/**
 * Sign-in drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * Empty here: each `@novastarter/auth-driver-*` package adds itself with a module augmentation —
 * `declare module '@novastarter/auth' { interface AuthDrivers { google: AuthDriverGoogleConfig } }` — so a location's
 * `options` are checked against the driver it names once the package is imported.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the driver packages
export interface AuthDrivers {}

/**
 * Registry of named sign-in locations — `google`, `github`, `credentials` — and the driver behind each, plus the
 * settings every function of the package reads.
 *
 * The {@link DriverManager} of the kit for sign-in: the application registers the driver classes it ships with and a
 * location per provider, built on its first use, so an unconfigured provider never opens a client. The settings are
 * what sessions, tokens and TOTP read their lifetimes, secrets and limiters from. The application wires it at
 * start-up through `useAuth()`.
 *
 * @example
 * ```ts
 * const auth = new AuthManager();
 *
 * auth.registerDriver('github', AuthDriverGithub);
 * auth.registerLocation('github', {
 * 	driver: 'github',
 * 	options: {
 * 		clientId: '…',
 * 		clientSecret: '…',
 * 	},
 * });
 * auth.registerSettings({
 * 	session: { ttl: 7 * 24 * 60 * 60 * 1000 },
 * });
 * ```
 */
export class AuthManager extends DriverManager<AuthDriver, AuthDrivers> {
	/**
	 * Settings registered by the application; empty until {@link registerSettings} runs.
	 *
	 * @internal
	 */
	private authSettings: AuthSettings = {};

	/**
	 * Register the settings of the process, replacing the previous ones.
	 *
	 * @param settings - Lifetimes, secrets and limiters; see {@link AuthSettings}.
	 */
	registerSettings(settings: AuthSettings): void {
		// Replace rather than merge, like `registerLocation`: a second bootstrap gets exactly what it registered
		this.authSettings = settings;
	}

	/**
	 * Return the registered settings.
	 *
	 * @returns The settings; an empty object when none were registered.
	 */
	settings(): AuthSettings {
		// By reference, not copied: the functions read it on every call, so a later `registerSettings` is seen at once
		// and the limiters keep their identity
		return this.authSettings;
	}
}
