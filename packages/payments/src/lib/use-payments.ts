import { PaymentsManager } from './payments-manager.js';

/**
 * The payments manager of the process, held at module level so it is built once.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 */
export const _cache: { payments: PaymentsManager | undefined } = { payments: undefined };

/**
 * Return the process-wide {@link PaymentsManager}, creating an empty one on first use.
 *
 * The application registers its drivers and locations on it at start-up; every later caller gets the same instance,
 * so the locations are shared across the process.
 *
 * @returns The same manager on every call.
 * @example
 * ```ts
 * // at start-up
 * const payments = usePayments();
 *
 * payments.registerDriver('lemonsqueezy', PaymentsDriverLemonSqueezy);
 * payments.registerLocation('default', {
 * 	driver: 'lemonsqueezy',
 * 	options: {
 * 		apiKey: env['PAYMENTS_LEMONSQUEEZY_API_KEY'],
 * 		webhookSecret: env['PAYMENTS_LEMONSQUEEZY_WEBHOOK_SECRET'],
 * 		storeId: env['PAYMENTS_LEMONSQUEEZY_STORE_ID'],
 * 	},
 * });
 *
 * // anywhere later
 * await usePayments().location('default').createCustomer({ email: 'ada@example.com' });
 * ```
 */
export const usePayments = (): PaymentsManager => {
	// 1. One manager per process: a second one would instantiate every driver, and its clients, again
	if (_cache.payments) {
		return _cache.payments;
	}

	_cache.payments = new PaymentsManager();

	return _cache.payments;
};
