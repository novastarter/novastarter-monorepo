/**
 * Tests of `to-event`: how a verified Lemon Squeezy delivery, read from fixtures in the shape of its documented
 * payloads, becomes the kit's event — which event names map to which types, which are dropped, and the delivery id.
 */
import { describe, expect, test } from 'vitest';
import { fixture } from '../fixtures/index.js';
import { deliveryIdOf, toEvent } from './to-event.js';

describe('toEvent', () => {
	/**
	 * The interval every variant answers with; the subscription payload does not carry it.
	 *
	 * @returns `month`.
	 */
	const intervalOf = async () => 'month' as const;

	test('Maps the order, subscription and payment events, drops the rest', async () => {
		// 1. The purchase: the checkout's custom data comes back as metadata, the subscription follows in its own event;
		//    every fixture carries the same `webhook_id` — the endpoint's, as real deliveries do — and the event id is
		//    derived from the event, the resource and its update time all the same
		await expect(toEvent(fixture('order_created'), intervalOf)).resolves.toMatchObject({
			id: 'order_created:5001:2026-09-01T10:00:00.000000Z',
			type: 'checkout.completed',
			provider: 'lemonsqueezy',
			occurredAt: new Date('2026-09-01T10:00:00.000000Z'),
			checkout: { id: '5001', customerId: '987', subscriptionId: null, metadata: { organizationId: 'org_123' } },
		});

		// 2. A new subscription, with the custom data that rode along under `meta`
		await expect(toEvent(fixture('subscription_created'), intervalOf)).resolves.toMatchObject({
			id: 'subscription_created:3001:2026-09-01T10:00:05.000000Z',
			type: 'subscription.created',
			subscription: { id: '3001', status: 'active', metadata: { organizationId: 'org_123', planId: 'pro' } },
		});

		// 3. A cancellation is an update — the grace period — and the id is derived even though the delivery carries a
		//    `webhook_id`
		await expect(toEvent(fixture('subscription_cancelled'), intervalOf)).resolves.toMatchObject({
			id: 'subscription_cancelled:3001:2026-09-15T12:00:00.000000Z',
			type: 'subscription.updated',
			subscription: { cancelAtPeriodEnd: true },
		});

		// 4. An expired subscription is over: the kit's deletion
		await expect(toEvent(fixture('subscription_expired'), intervalOf)).resolves.toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled' },
		});

		// 5. The payment events carry the subscription invoice, paid or still open
		await expect(toEvent(fixture('subscription_payment_success'), intervalOf)).resolves.toMatchObject({
			type: 'invoice.paid',
			invoice: { id: '9001', status: 'paid' },
		});

		await expect(toEvent(fixture('subscription_payment_failed'), intervalOf)).resolves.toMatchObject({
			type: 'invoice.failed',
			invoice: { id: '9001', status: 'open' },
		});

		// 6. Anything the kit does not act on is dropped, not refused: the route acknowledges it
		await expect(toEvent(fixture('license_key_created'), intervalOf)).resolves.toBeNull();
	});

	test('deliveryIdOf derives a per-event id even though the delivery carries a webhook_id', () => {
		// 1. `meta.webhook_id` is the id of the webhook configuration, identical on every delivery of one endpoint;
		//    keying the idempotency guard on it would drop every event after the first, so it is ignored
		const created = deliveryIdOf(fixture<{ updated_at?: string }>('subscription_created'));
		const expired = deliveryIdOf(fixture<{ updated_at?: string }>('subscription_expired'));

		expect(created).toBe('subscription_created:3001:2026-09-01T10:00:05.000000Z');
		expect(expired).not.toBe(created);
	});
});
