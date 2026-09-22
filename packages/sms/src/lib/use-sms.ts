import { type Singleton, singleton } from '@novastarter/utils';
import { SmsManager } from './sms-manager.js';

/**
 * Return the process-wide {@link SmsManager}, creating one with only the built-in driver on first use.
 *
 * The application registers its vendor drivers, locations and routes on it at start-up; `sendSms()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call; `useSms.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const sms = useSms();
 *
 * sms.registerDriver('twilio', SmsDriverTwilio);
 * sms.registerLocation('main', {
 * 	driver: 'twilio',
 * 	options: {
 * 		accountSid: env['SMS_TWILIO_ACCOUNT_SID'],
 * 		authToken: env['SMS_TWILIO_AUTH_TOKEN'],
 * 	},
 * });
 * sms.registerRoutes({
 * 	from: env['SMS_FROM'],
 * });
 *
 * // anywhere later
 * await sendSms({
 * 	to: user.phone,
 * 	text: `Your code is ${code}`,
 * });
 * ```
 */
export const useSms: Singleton<SmsManager> = singleton(() => new SmsManager());
