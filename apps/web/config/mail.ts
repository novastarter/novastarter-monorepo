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
 * @returns The location to register — `console` by default outside production, so a fresh clone reads its mail in
 * the terminal — and the sender every message goes out from.
 * @throws Error in production without `MAIL_DRIVER`: booting would deliver nothing and log every message instead.
 */
export const mailConfig = (env: AppEnv): MailConfig => {
	// 1. Outside production the console driver is the default, so a fresh clone reads its mail in the terminal;
	//    production must name a driver explicitly — a silent console default would log verification links and
	//    password-reset tokens instead of delivering them
	const driver = env.MAIL_DRIVER ?? (env.NODE_ENV === 'production' ? undefined : 'console');

	if (driver === undefined) {
		// 2. Refusing to boot beats delivering nothing: without a driver, every message would be written to the log
		throw new Error(
			'MAIL_DRIVER is required in production: set it to a driver that delivers (sendmail, or smtp or a vendor driver wired in config/mail.ts)',
		);
	}

	// 3. One branch per driver, so each location stays typed against the options its constructor takes; both drivers
	//    selectable here need no further configuration — smtp, file and vendor drivers are wired here as they are added
	switch (driver) {
		case 'console':
			return {
				location: {
					driver,
					options: {},
				},
				routes: {
					from: env.MAIL_FROM,
				},
			};
		case 'sendmail':
			return {
				location: {
					driver,
					options: {},
				},
				routes: {
					from: env.MAIL_FROM,
				},
			};
	}
};
