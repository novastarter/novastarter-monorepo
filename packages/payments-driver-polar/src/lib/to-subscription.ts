import type { BillingInterval, Subscription, SubscriptionStatus } from '@novastarter/payments';
import type { Subscription as PolarSubscription } from '@polar-sh/sdk/models/components/subscription.js';
import { toMetadata } from './to-metadata.js';

/**
 * The statuses Polar reports, the same set as the kit's.
 *
 * @defaultValue Polar's eight statuses.
 */
export const POLAR_STATUSES: readonly SubscriptionStatus[] = [
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused',
];

/**
 * A Polar subscription as the kit sees it.
 *
 * Polar sells products, not prices: the product id is what the catalog lists under `providerIds.polar`, so it fills
 * both `priceId` and `productId`. Seats come from `seats`, one when the product is not seat-based.
 *
 * @param subscription - Polar's, as retrieved or as a webhook carried it.
 * @returns The normalised subscription.
 * @throws Error for a status the kit does not know — a change on Polar's side the mapping has to learn.
 */
export const toSubscription = (subscription: PolarSubscription): Subscription => {
	// An unknown status is a change on Polar's side, better loud than silently wrong
	if (!POLAR_STATUSES.includes(subscription.status as SubscriptionStatus)) {
		throw new Error(`Polar subscription "${subscription.id}" has an unknown status "${String(subscription.status)}"`);
	}

	return {
		id: subscription.id,
		customerId: subscription.customerId,
		status: subscription.status as SubscriptionStatus,
		priceId: subscription.productId,
		productId: subscription.productId,
		quantity: subscription.seats ?? 1,
		interval: subscription.recurringInterval as BillingInterval,
		currentPeriodStart: subscription.currentPeriodStart,
		currentPeriodEnd: subscription.currentPeriodEnd,
		cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
		// `endsAt` is when a scheduled cancellation takes effect — the kit's `cancelAt`
		cancelAt: subscription.endsAt,
		canceledAt: subscription.canceledAt,
		trialEnd: subscription.trialEnd,
		endedAt: subscription.endedAt,
		metadata: toMetadata(subscription.metadata),
	};
};
