import type { PaymentsEvent } from '@novastarter/payments';
import type { EventEntity, SubscriptionNotification } from '@paddle/paddle-node-sdk';
import { toInvoice } from './to-invoice.js';
import { toSubscription } from './to-subscription.js';

/**
 * The driver's name, as events carry it.
 *
 * @defaultValue `paddle`
 */
export const PROVIDER = 'paddle';

/**
 * Paddle's subscription events that are a change of an existing subscription — every one of them arrives alongside
 * `subscription.updated` for the same change, so they are mapped the same way.
 *
 * A `subscription.updated` whose status is `canceled` is dropped rather than mapped: `subscription.canceled` owns the
 * deletion, and a retried or late `updated` would otherwise resurrect a subscription the deletion already ended.
 *
 * @defaultValue `subscription.updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`, `imported`
 */
export const SUBSCRIPTION_UPDATE_EVENTS: ReadonlySet<string> = new Set([
	'subscription.updated',
	'subscription.activated',
	'subscription.trialing',
	'subscription.past_due',
	'subscription.paused',
	'subscription.resumed',
	'subscription.imported',
]);

/**
 * A verified Paddle event as the kit's, or `null` for one the kit does not act on.
 *
 * - `subscription.created` → `subscription.created`; the status changes (`activated`, `trialing`, `past_due`,
 *   `paused`, `resumed`, `updated`, `imported`) → `subscription.updated`; `subscription.canceled` →
 *   `subscription.deleted`, since a canceled Paddle subscription is over. A `subscription.updated` whose status is
 *   `canceled` is dropped — the cancellation is the `subscription.canceled` event's news, and acting on the update
 *   as well could undo the deletion.
 * - `transaction.completed` → `invoice.paid`; `transaction.payment_failed` → `invoice.failed`. The transaction of a
 *   checkout completes as well, so the first payment arrives the same way as a renewal; the subscription it created
 *   comes in its own event with the checkout's custom data copied onto it, which is what the sync needs — hence no
 *   `checkout.completed` from Paddle.
 *
 * Everything else — customers, addresses, prices, payouts, the other transaction states — is verified and dropped.
 *
 * @param event - What `webhooks.unmarshal()` handed back.
 * @returns The normalised event, or `null`.
 * @throws Error for a status the kit does not know, or a subscription without items — a change on Paddle's side the
 * mapping has to learn.
 */
export const toEvent = (event: EventEntity): PaymentsEvent | null => {
	// 1. What every event shares: Paddle's event id, the driver name, when it happened, the raw event
	const base = { id: event.eventId, provider: PROVIDER, occurredAt: new Date(event.occurredAt), raw: event };

	// 2. One branch per Paddle event type the kit acts on; the status changes are matched by set
	switch (event.eventType) {
		case 'subscription.created':
			return { ...base, type: 'subscription.created', subscription: toSubscription(event.data) };

		case 'subscription.canceled':
			return { ...base, type: 'subscription.deleted', subscription: toSubscription(event.data) };

		case 'transaction.completed':
			return { ...base, type: 'invoice.paid', invoice: toInvoice(event.data) };

		case 'transaction.payment_failed':
			return { ...base, type: 'invoice.failed', invoice: toInvoice(event.data) };

		default:
			// 3. The status changes share one shape; the type narrowing above cannot express the set, so the data is
			//    read through the notification shape they all carry
			if (SUBSCRIPTION_UPDATE_EVENTS.has(event.eventType)) {
				const data = event.data as SubscriptionNotification;

				// 4. The canceled status is the `subscription.canceled` event's news, which maps to the kit's deletion:
				//    dropping the update keeps a retried or late one from resurrecting a deleted subscription
				if (data.status === 'canceled') return null;

				return { ...base, type: 'subscription.updated', subscription: toSubscription(data) };
			}

			return null;
	}
};
