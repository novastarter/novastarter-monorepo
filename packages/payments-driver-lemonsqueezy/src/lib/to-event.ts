import type { BillingInterval, PaymentsEvent } from '@novastarter/payments';
import type {
	LsOrderAttributes,
	LsSubscriptionAttributes,
	LsSubscriptionInvoiceAttributes,
	LsWebhookPayload,
} from '../types.js';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

/**
 * The driver's name, as events carry it.
 *
 * @defaultValue `lemonsqueezy`
 */
export const PROVIDER = 'lemonsqueezy';

/**
 * The subscription events that are a change of an existing subscription.
 *
 * @defaultValue `subscription_updated`, `_cancelled`, `_resumed`, `_paused`, `_unpaused`, `_plan_changed`
 */
export const SUBSCRIPTION_UPDATE_EVENTS: ReadonlySet<string> = new Set([
	'subscription_updated',
	'subscription_cancelled',
	'subscription_resumed',
	'subscription_paused',
	'subscription_unpaused',
	'subscription_plan_changed',
]);

/**
 * Where the billing interval of a variant comes from: the subscription payload does not carry it.
 */
export type IntervalResolver = (variantId: string) => Promise<BillingInterval>;

/**
 * The id of a delivery: the event name, the resource id and its update time — the same for a retry of one event,
 * different for a later change of the resource.
 *
 * `meta.webhook_id` is never used even though real deliveries carry it: it is the id of the *webhook configuration*
 * the delivery was sent to — identical on every delivery of that endpoint — so deduplicating on it would apply the
 * first event and drop every later one.
 *
 * @param payload - The delivery.
 * @returns The id.
 */
export const deliveryIdOf = (payload: LsWebhookPayload<{ updated_at?: string }>): string =>
	`${payload.meta.event_name}:${payload.data.id}:${payload.data.attributes.updated_at ?? ''}`;

/**
 * A verified Lemon Squeezy delivery as the kit's event, or `null` for one the kit does not act on.
 *
 * - `order_created` → `checkout.completed`: the purchase, with the checkout's custom data; the subscription it
 *   created follows in its own event.
 * - `subscription_created` → `subscription.created`; `subscription_updated`, `_cancelled`, `_resumed`, `_paused`,
 *   `_unpaused` and `_plan_changed` → `subscription.updated` (a cancelled subscription is on its grace period, the
 *   kit's `cancelAtPeriodEnd`); `subscription_expired` → `subscription.deleted`, since an expired one is over.
 * - `subscription_payment_success` and `_recovered` → `invoice.paid`; `subscription_payment_failed` →
 *   `invoice.failed`. A refund (`_payment_refunded`) is not an unpaid invoice and is dropped.
 *
 * Everything else — license keys, affiliates, order refunds — is verified and dropped.
 *
 * @param payload - The delivery, parsed.
 * @param intervalOf - Reads a variant's billing interval, for the subscription events.
 * @returns The normalised event, or `null`.
 * @throws Error for a status the kit does not know — a change on Lemon Squeezy's side the mapping has to learn.
 * @throws LemonSqueezyApiError when the variant read a subscription event needs fails.
 */
export const toEvent = async (
	payload: LsWebhookPayload,
	intervalOf: IntervalResolver,
): Promise<PaymentsEvent | null> => {
	const name = payload.meta.event_name;
	const attributes = payload.data.attributes as { updated_at?: string; created_at?: string };
	const occurredAt = new Date(attributes.updated_at ?? attributes.created_at ?? Date.now());

	const base = {
		id: deliveryIdOf(payload as LsWebhookPayload<{ updated_at?: string }>),
		provider: PROVIDER,
		occurredAt,
		raw: payload,
	};

	// The checkout's custom data rides under `meta` on every event of the order and the subscription.
	const metadata = toMetadata(payload.meta.custom_data);

	const subscriptionEvent = async (
		type: 'subscription.created' | 'subscription.updated' | 'subscription.deleted',
	): Promise<PaymentsEvent> => {
		// The subscription payload does not carry the interval, so it is read from the variant.
		const data = payload.data as LsWebhookPayload<LsSubscriptionAttributes>['data'];
		const interval = await intervalOf(String(data.attributes.variant_id));

		return { ...base, type, subscription: toSubscription(data, { interval, metadata }) };
	};

	// The update family is matched by set; any other event name is dropped.
	switch (name) {
		case 'order_created': {
			const order = payload.data as LsWebhookPayload<LsOrderAttributes>['data'];

			return {
				...base,
				type: 'checkout.completed',
				checkout: { id: order.id, customerId: String(order.attributes.customer_id), subscriptionId: null, metadata },
			};
		}

		case 'subscription_created':
			return subscriptionEvent('subscription.created');

		case 'subscription_expired':
			return subscriptionEvent('subscription.deleted');

		case 'subscription_payment_success':
		case 'subscription_payment_recovered':
			return {
				...base,
				type: 'invoice.paid',
				invoice: toInvoice(payload.data as LsWebhookPayload<LsSubscriptionInvoiceAttributes>['data']),
			};

		case 'subscription_payment_failed':
			return {
				...base,
				type: 'invoice.failed',
				invoice: toInvoice(payload.data as LsWebhookPayload<LsSubscriptionInvoiceAttributes>['data']),
			};

		default:
			return SUBSCRIPTION_UPDATE_EVENTS.has(name) ? subscriptionEvent('subscription.updated') : null;
	}
};
