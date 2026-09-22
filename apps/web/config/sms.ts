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
 * @returns The location to register — the console driver, so a fresh clone reads its one-time codes in the
 * terminal — and the sender every message goes out from.
 */
export const smsConfig = (env: AppEnv): SmsConfig => ({
	location: {
		driver: 'console',
		options: {},
	},
	routes: {
		from: env.SMS_FROM,
	},
});
