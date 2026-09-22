import type { SmsDrivers, SmsRoutes } from '@novastarter/sms';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * The SMS configuration of the app: the `default` location and the routes.
 */
export interface SmsConfig {
	location: LocationConfig<SmsDrivers>;
	routes: SmsRoutes;
}

/**
 * The `default` SMS location and the routes.
 *
 * @param env - The app's variables.
 * @returns The location to register — `console` by default outside production, so a fresh clone reads its one-time
 * codes in the terminal — and the sender every message goes out from.
 * @throws Error in production without `SMS_DRIVER`: booting would deliver nothing and log every one-time code
 * instead.
 */
export const smsConfig = (env: AppEnv): SmsConfig => {
	// 1. Outside production the console driver is the default, so a fresh clone reads its one-time codes in the
	//    terminal; production must name a driver explicitly — a silent console default would log every code instead
	//    of delivering it
	const driver = env.SMS_DRIVER ?? (env.NODE_ENV === 'production' ? undefined : 'console');

	if (driver === undefined) {
		// 2. Refusing to boot beats delivering nothing: without a driver, every message would be written to the log
		throw new Error(
			'SMS_DRIVER is required in production: the console driver would log one-time codes instead of delivering them — wire a vendor driver in config/sms.ts',
		);
	}

	return {
		location: {
			driver,
			options: {},
		},
		routes: {
			from: env.SMS_FROM,
		},
	};
};
