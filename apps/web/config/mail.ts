import type { MailDrivers, MailRoutes } from '@novastarter/mail';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * The mail configuration of the app: the locations and the routes between them.
 */
export interface MailConfig {
	locations: Record<string, LocationConfig<MailDrivers>>;
	routes: MailRoutes;
}

/**
 * Mail locations by name and the routes between them.
 *
 * @param env - The app's variables.
 * @returns The locations to register — the console driver, so a fresh clone reads its mail in the terminal — and the
 * sender every message goes out from.
 */
export const mailConfig = (env: AppEnv): MailConfig => ({
	locations: {
		default: {
			driver: 'console',
			options: {},
		},
	},
	routes: {
		from: env.MAIL_FROM,
	},
});
