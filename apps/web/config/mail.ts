import type { MailDrivers, MailRoutes } from '@novastarter/mail';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * The mail configuration of the app: the `default` location and the routes.
 */
export interface MailConfig {
	location: LocationConfig<MailDrivers>;
	routes: MailRoutes;
}

/**
 * The `default` mail location and the routes.
 *
 * @param env - The app's variables.
 * @returns The location to register — the console driver, so a fresh clone reads its mail in the terminal — and the
 * sender every message goes out from.
 */
export const mailConfig = (env: AppEnv): MailConfig => ({
	location: {
		driver: 'console',
		options: {},
	},
	routes: {
		from: env.MAIL_FROM,
	},
});
