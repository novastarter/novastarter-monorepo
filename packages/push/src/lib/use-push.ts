import { PushManager } from './push-manager.js';

/**
 * The manager of the process.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 */
export const _cache: { push: PushManager | undefined } = { push: undefined };

/**
 * Return the process-wide {@link PushManager}, creating one with only the built-in driver on first use.
 *
 * The application registers its vendor drivers, locations and routes on it at start-up; `sendPush()` looks the
 * locations up on the same instance afterwards.
 *
 * @returns The same manager on every call.
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
export const usePush = (): PushManager => {
	// 1. One manager per process: a second one would build every location, and its clients, again
	if (_cache.push) {
		return _cache.push;
	}

	_cache.push = new PushManager();

	return _cache.push;
};
