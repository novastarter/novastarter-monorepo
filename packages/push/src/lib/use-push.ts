import { type Singleton, singleton } from '@novastarter/utils';
import { PushManager } from './push-manager.js';

/**
 * Return the process-wide {@link PushManager}, creating one with only the built-in driver on first use.
 *
 * The application registers its vendor drivers, locations and routes on it at start-up; `sendPush()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call; `usePush.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const push = usePush();
 *
 * push.registerDriver('webpush', PushDriverWebPush);
 * push.registerLocation('webpush', {
 * 	driver: 'webpush',
 * 	options: {
 * 		publicKey: env['PUSH_WEBPUSH_PUBLIC_KEY'],
 * 		privateKey: env['PUSH_WEBPUSH_PRIVATE_KEY'],
 * 		subject: env['PUSH_WEBPUSH_SUBJECT'],
 * 	},
 * });
 * push.registerRoutes({
 * 	webpush: 'webpush',
 * });
 *
 * // anywhere later
 * await sendPush({
 * 	subscription,
 * 	title: 'Invoice paid',
 * 	url: '/dashboard/billing/invoices',
 * });
 * ```
 */
export const usePush: Singleton<PushManager> = singleton(() => new PushManager());
