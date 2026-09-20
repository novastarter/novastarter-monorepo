import type { CompletedCheckout, PaymentsEvent } from '@novastarter/payments';
import type { Checkout } from '@polar-sh/sdk/models/components/checkout.js';
import type { validateEvent } from '@polar-sh/sdk/webhooks';
import { toInvoice } from './to-invoice.js';
import { toMetadata } from './to-metadata.js';
import { toSubscription } from './to-subscription.js';

/**
 * The driver's name, as events carry it.
 *
 * @defaultValue `polar`
 */
export const PROVIDER = 'polar';

/**
 * What `validateEvent` hands back: one of Polar's webhook payloads.
 */
export type PolarWebhookPayload = ReturnType<typeof validateEvent>;

/**
 * A succeeded Polar checkout as the kit sees it.
 *
 * @param checkout - Polar's.
 * @returns The checkout, with the subscription it created.
 */
export const toCompletedCheckout = (checkout: Checkout): CompletedCheckout => ({
	id: checkout.id,
	customerId: checkout.customerId ?? '',
	subscriptionId: checkout.subscriptionId ?? null,
	metadata: toMetadata(checkout.metadata),
});

/**
 * The id of a Polar webhook delivery: the `webhook-id` header, which Polar keeps stable across retries of one event.
 *
 * @param headers - The request headers, lower-cased.
 * @returns The id, or nothing.
 */
export const deliveryIdOf = (headers: Record<string, string | undefined>): string | undefined => headers['webhook-id'];

/**
 * A verified Polar payload as the kit's event, or `null` for one the kit does not act on.
 *
 * - `checkout.updated` with status `succeeded` → `checkout.completed`.
 * - `subscription.created` → `subscription.created`; `subscription.updated` → `subscription.updated` (Polar's
 *   catch-all, sent alongside the specific `active`, `canceled`, `uncanceled`, `past_due` and `revoked` events, which
 *   are therefore dropped so one change arrives once); `subscription.revoked` → `subscription.deleted`, since a
 *   revoked subscription is over.
 * - `order.paid` → `invoice.paid`. Polar reports a failed renewal as `subscription.past_due` — the status change
 *   arrives through `subscription.updated`; there is no `invoice.failed` from Polar.
 *
 * Everything else — benefits, customers, products, refunds — is verified and dropped.
 *
 * @param payload - What `validateEvent` handed back.
 * @param id - The delivery id, from the `webhook-id` header.
 * @returns The normalised event, or `null`.
 */
export const toEvent = (payload: PolarWebhookPayload, id: string): PaymentsEvent | null => {
	// 1. What every event shares: the delivery id, the driver name, when it happened, the raw payload
	const base = { id, provider: PROVIDER, occurredAt: payload.timestamp, raw: payload };

	// 2. One branch per Polar event type the kit acts on; everything else is dropped
	switch (payload.type) {
		case 'checkout.updated':
			// 3. A checkout is updated many times; only the one that succeeded is a purchase
			if (payload.data.status !== 'succeeded') return null;

			return { ...base, type: 'checkout.completed', checkout: toCompletedCheckout(payload.data) };

		case 'subscription.created':
			return { ...base, type: 'subscription.created', subscription: toSubscription(payload.data) };

		case 'subscription.updated':
			return { ...base, type: 'subscription.updated', subscription: toSubscription(payload.data) };

		case 'subscription.revoked':
			return { ...base, type: 'subscription.deleted', subscription: toSubscription(payload.data) };

		case 'order.paid':
			return { ...base, type: 'invoice.paid', invoice: toInvoice(payload.data) };

		default:
			return null;
	}
};
