import type { BillingInterval, Subscription, SubscriptionStatus } from '@novastarter/payments';
import type Stripe from 'stripe';
import { fromUnix } from './from-unix.js';
import { idOf } from './id-of.js';

/**
 * The statuses Stripe reports, all of which the kit's set covers.
 *
 * @defaultValue Stripe's eight statuses.
 */
export const STRIPE_STATUSES: readonly SubscriptionStatus[] = [
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
 * A Stripe subscription as the kit sees it.
 *
 * Reads the first subscription item: the kit sells one price per subscription (a plan, times its seats), and since
 * API version 2025-03-31 the billing period lives on the item, not on the subscription — an endpoint pinned to an
 * earlier API version still receives deliveries carrying it on the subscription, which is read as the fallback.
 *
 * @param subscription - Stripe's, as retrieved or as a webhook carried it.
 * @returns The normalised subscription.
 * @throws Error for a subscription without items or with a status the kit does not know — either means Stripe
 * changed something the mapping has to learn, better loud than silently wrong.
 */
export const toSubscription = (subscription: Stripe.Subscription): Subscription => {
	// A subscription with several items would need a model the kit does not have.
	const item = subscription.items.data[0];

	if (!item) {
		throw new Error(`Stripe subscription "${subscription.id}" has no items`);
	}

	// Stripe's status set is the kit's; an unknown one is a change on Stripe's side.
	if (!STRIPE_STATUSES.includes(subscription.status as SubscriptionStatus)) {
		throw new Error(`Stripe subscription "${subscription.id}" has an unknown status "${subscription.status}"`);
	}

	// The period comes from the item since API version 2025-03-31, with the subscription itself as the fallback: a
	// webhook endpoint pinned to an earlier API version still carries the period there, and silently mapping no period
	// at all would hide that version drift. The subscription's fields are gone from the current types, so the older
	// shape is read through a cast.
	const legacyPeriod = subscription as { current_period_start?: number; current_period_end?: number };

	return {
		id: subscription.id,
		customerId: idOf(subscription.customer) ?? '',
		status: subscription.status as SubscriptionStatus,
		priceId: item.price.id,
		productId: idOf(item.price.product),
		quantity: item.quantity ?? 1,
		interval: (item.price.recurring?.interval ?? 'month') as BillingInterval,
		currentPeriodStart: fromUnix(item.current_period_start ?? legacyPeriod.current_period_start),
		currentPeriodEnd: fromUnix(item.current_period_end ?? legacyPeriod.current_period_end),
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
		cancelAt: fromUnix(subscription.cancel_at),
		canceledAt: fromUnix(subscription.canceled_at),
		trialEnd: fromUnix(subscription.trial_end),
		endedAt: fromUnix(subscription.ended_at),
		metadata: subscription.metadata ?? {},
	};
};
