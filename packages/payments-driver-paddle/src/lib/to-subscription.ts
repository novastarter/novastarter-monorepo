import type { BillingInterval, Subscription, SubscriptionStatus } from '@novastarter/payments';
import type { Subscription as PaddleSubscription, SubscriptionNotification } from '@paddle/paddle-node-sdk';
import { toMetadata } from './to-metadata.js';

/**
 * A Paddle subscription as the API returns it or as a webhook carries it — the notification shape names the same
 * fields, with the item's price optional; the created notification adds the transaction id on top.
 */
export type PaddleSubscriptionLike = PaddleSubscription | SubscriptionNotification;

/**
 * How Paddle's five statuses read as the kit's: the same words, `canceled` included.
 *
 * @defaultValue `active`, `canceled`, `past_due`, `paused`, `trialing`
 */
export const PADDLE_STATUSES: Record<string, SubscriptionStatus> = {
	active: 'active',
	canceled: 'canceled',
	past_due: 'past_due',
	paused: 'paused',
	trialing: 'trialing',
};

/**
 * A Paddle subscription as the kit sees it.
 *
 * Paddle bills prices of products, so the first item's price is the catalog's `providerIds.paddle`; its quantity is
 * the seat count. A scheduled cancellation is `scheduled_change` with the action `cancel` — the kit's
 * `cancelAtPeriodEnd` and `cancelAt`; a `canceled` subscription is over, `canceledAt` doubling as `endedAt`.
 *
 * @param subscription - Paddle's, as retrieved or as a webhook carried it.
 * @returns The normalised subscription.
 * @throws Error for a status the kit does not know — a change on Paddle's side the mapping has to learn — or a
 * subscription without items.
 */
export const toSubscription = (subscription: PaddleSubscriptionLike): Subscription => {
	// An unknown status is a change on Paddle's side, better loud than silently wrong
	const status = PADDLE_STATUSES[subscription.status];

	if (!status) {
		throw new Error(`Paddle subscription "${subscription.id}" has an unknown status "${String(subscription.status)}"`);
	}

	// One price per subscription is what the kit sells; the first item is that price
	const item = subscription.items[0];

	if (!item) {
		throw new Error(`Paddle subscription "${subscription.id}" has no items`);
	}

	// A scheduled cancellation is the kit's `cancelAtPeriodEnd`; a canceled subscription ended when it was canceled
	const cancel = subscription.scheduledChange?.action === 'cancel' ? subscription.scheduledChange : null;
	const canceledAt = subscription.canceledAt ? new Date(subscription.canceledAt) : null;

	return {
		id: subscription.id,
		customerId: subscription.customerId,
		status,
		priceId: item.price?.id ?? '',
		productId: item.price?.productId ?? item.product?.id ?? null,
		quantity: item.quantity,
		interval: subscription.billingCycle.interval as BillingInterval,
		currentPeriodStart: subscription.currentBillingPeriod ? new Date(subscription.currentBillingPeriod.startsAt) : null,
		currentPeriodEnd: subscription.currentBillingPeriod ? new Date(subscription.currentBillingPeriod.endsAt) : null,
		cancelAtPeriodEnd: cancel !== null,
		cancelAt: cancel ? new Date(cancel.effectiveAt) : null,
		canceledAt,
		trialEnd: item.trialDates ? new Date(item.trialDates.endsAt) : null,
		endedAt: status === 'canceled' ? canceledAt : null,
		metadata: toMetadata(subscription.customData),
	};
};
