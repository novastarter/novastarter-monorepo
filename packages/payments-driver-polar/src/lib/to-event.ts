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
export const toCompletedCheckout = (checkout: Checkout): CompletedCheckout => {
	// A succeeded checkout always has a customer, but the SDK types it optional; an empty id keeps the shape rather
	// than failing a delivery the signature already verified
	return {
		id: checkout.id,
		customerId: checkout.customerId ?? '',
		subscriptionId: checkout.subscriptionId ?? null,
		metadata: toMetadata(checkout.metadata),
	};
};

/**
 * The id of a Polar webhook delivery: the `webhook-id` header, which Polar keeps stable across retries of one event.
 *
 * @typeParam T - The headers' record type, so a record known to hold the header yields the id, not `undefined`.
 * @param headers - The request headers, lower-cased.
 * @returns The id, or nothing for a record without it.
 */
export const deliveryIdOf = <T extends Record<string, string | undefined>>(headers: T): T['webhook-id'] => {
	// The Standard Webhooks id is the one value that survives Polar's retries, so it is the id to deduplicate on
	return headers['webhook-id'] as T['webhook-id'];
};

/**
 * A verified Polar payload as the kit's event, or `null` for one the kit does not act on.
 *
 * - `checkout.updated` with status `succeeded` → `checkout.completed`.
 * - `subscription.created` → `subscription.created`; `subscription.updated` → `subscription.updated` (Polar's
 *   catch-all, sent alongside the specific `active`, `canceled`, `uncanceled`, `past_due` and `revoked` events, which
 *   are therefore dropped so one change arrives once) — except when the status is `canceled`, which is the
 *   `subscription.revoked` event's news, so the update is dropped rather than re-announcing a deleted subscription;
 *   `subscription.revoked` → `subscription.deleted`, since a revoked subscription is over.
 * - `order.paid` → `invoice.paid`. Polar reports a failed renewal as `subscription.past_due` — the status change
 *   arrives through `subscription.updated`; there is no `invoice.failed` from Polar.
 *
 * Everything else — benefits, customers, products, refunds — is verified and dropped.
 *
 * @param payload - What `validateEvent` handed back.
 * @param id - The delivery id, from the `webhook-id` header.
 * @returns The normalised event, or `null`.
 * @throws Error for a status the kit does not know — a change on Polar's side the mapping has to learn.
 */
export const toEvent = (payload: PolarWebhookPayload, id: string): PaymentsEvent | null => {
	const base = { id, provider: PROVIDER, occurredAt: payload.timestamp, raw: payload };

	switch (payload.type) {
		case 'checkout.updated':
			// A checkout is updated many times; only the one that succeeded is a purchase
			if (payload.data.status !== 'succeeded') return null;

			return { ...base, type: 'checkout.completed', checkout: toCompletedCheckout(payload.data) };

		case 'subscription.created':
			return { ...base, type: 'subscription.created', subscription: toSubscription(payload.data) };

		case 'subscription.updated':
			// The canceled status is the `subscription.revoked` event's news, which maps to the kit's deletion:
			// dropping the update keeps a retried or late one from re-announcing a deleted subscription
			if (payload.data.status === 'canceled') return null;

			return { ...base, type: 'subscription.updated', subscription: toSubscription(payload.data) };

		case 'subscription.revoked':
			return { ...base, type: 'subscription.deleted', subscription: toSubscription(payload.data) };

		case 'order.paid':
			return { ...base, type: 'invoice.paid', invoice: toInvoice(payload.data) };

		default:
			return null;
	}
};
