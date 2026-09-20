import type { BillingInterval, Subscription, SubscriptionStatus } from '@novastarter/payments';
import type { LsResource, LsSubscriptionAttributes, LsSubscriptionStatus } from '../types.js';

/**
 * How Lemon Squeezy's statuses read as the kit's.
 *
 * A `cancelled` subscription is on its grace period — paid for and valid until `ends_at` — which is the kit's
 * `active` with `cancelAtPeriodEnd`; `expired` is the one that is over. `pause` is the transient spelling of
 * `paused` some payloads carry.
 *
 * @defaultValue `on_trial` → `trialing`, `active`, `paused` / `pause` → `paused`, `past_due`, `unpaid`, `cancelled` →
 * `active`, `expired` → `canceled`
 */
export const LS_STATUSES: Record<LsSubscriptionStatus, SubscriptionStatus> = {
	on_trial: 'trialing',
	active: 'active',
	paused: 'paused',
	pause: 'paused',
	past_due: 'past_due',
	unpaid: 'unpaid',
	cancelled: 'active',
	expired: 'canceled',
};

/**
 * What the subscription itself does not carry: the variant's billing interval (the variant has it, the
 * subscription does not) and the checkout's custom data (a webhook's `meta` has it, the API's resource does not).
 */
export interface SubscriptionContext {
	interval: BillingInterval;
	metadata?: Record<string, string> | undefined;
}

/**
 * A Lemon Squeezy subscription as the kit sees it.
 *
 * Lemon Squeezy sells variants of products: the variant id is what the catalog lists under
 * `providerIds.lemonsqueezy`, so it fills `priceId`; the product id fills `productId`. The seat count is the first
 * subscription item's quantity. The current period ends at `renews_at`; its start is not reported.
 *
 * @param subscription - Lemon Squeezy's, as retrieved or as a webhook carried it.
 * @param context - The interval and the metadata, from wherever the caller found them.
 * @returns The normalised subscription.
 * @throws Error for a status the kit does not know — a change on Lemon Squeezy's side the mapping has to learn.
 */
export const toSubscription = (
	subscription: LsResource<LsSubscriptionAttributes>,
	context: SubscriptionContext,
): Subscription => {
	const attributes = subscription.attributes;
	const status = LS_STATUSES[attributes.status];

	// 1. An unknown status is a change on Lemon Squeezy's side, better loud than silently wrong
	if (!status) {
		throw new Error(
			`Lemon Squeezy subscription "${subscription.id}" has an unknown status "${String(attributes.status)}"`,
		);
	}

	// 2. A cancelled subscription ends at `ends_at`; an expired one ended there
	const cancelled = attributes.status === 'cancelled';
	const endsAt = attributes.ends_at ? new Date(attributes.ends_at) : null;

	// 3. The period start is not reported; the seat count defaults to one for a subscription without items
	return {
		id: subscription.id,
		customerId: String(attributes.customer_id),
		status,
		priceId: String(attributes.variant_id),
		productId: String(attributes.product_id),
		quantity: attributes.first_subscription_item?.quantity ?? 1,
		interval: context.interval,
		currentPeriodStart: null,
		currentPeriodEnd: attributes.renews_at ? new Date(attributes.renews_at) : null,
		cancelAtPeriodEnd: cancelled,
		cancelAt: cancelled ? endsAt : null,
		canceledAt: cancelled || status === 'canceled' ? new Date(attributes.updated_at) : null,
		trialEnd: attributes.trial_ends_at ? new Date(attributes.trial_ends_at) : null,
		endedAt: status === 'canceled' ? endsAt : null,
		metadata: context.metadata ?? {},
	};
};
