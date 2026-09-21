import { type Singleton, singleton } from '@novastarter/utils';
import { PaymentsManager } from './payments-manager.js';

/**
 * Return the process-wide {@link PaymentsManager}, creating an empty one on first use.
 *
 * The application registers its drivers and locations on it at start-up; every later caller gets the same instance,
 * so the locations are shared across the process.
 *
 * @returns The same manager on every call; `usePayments.reset()` drops it, for tests.
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
export const usePayments: Singleton<PaymentsManager> = singleton(() => new PaymentsManager());
