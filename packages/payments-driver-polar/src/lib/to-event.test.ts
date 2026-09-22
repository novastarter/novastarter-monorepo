/**
 * Tests of `to-event`: which Polar webhook payloads become the kit's events and which are dropped, read from the
 * fixtures through the SDK's own parser.
 */
import { describe, expect, test } from 'vitest';
import { parsed } from '../fixtures/index.js';
import { deliveryIdOf, toCompletedCheckout, toEvent } from './to-event.js';

describe('toEvent', () => {
	test('Maps the events the kit acts on and drops the rest', () => {
		// 1. A succeeded checkout is a purchase, with the subscription Polar created and the metadata it copied over
		expect(toEvent(parsed('checkout.updated'), 'msg_1')).toMatchObject({
			id: 'msg_1',
			type: 'checkout.completed',
			provider: 'polar',
			occurredAt: new Date('2026-09-10T12:00:00Z'),
			checkout: {
				id: 'b2a1c0d9-6666-4f66-8b66-000000000006',
				customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
				subscriptionId: 'd9c8b7a6-5555-4e55-9a55-000000000005',
				metadata: { organizationId: 'org_42', planId: 'pro' },
			},
		});

		// 2. A checkout still open is not a purchase yet
		expect(toEvent(parsed('checkout.updated.open'), 'msg_0')).toBeNull();

		// 3. The subscription lifecycle: created, the catch-all update, and revoked as the end of the subscription
		expect(toEvent(parsed('subscription.created'), 'msg_2')).toMatchObject({
			type: 'subscription.created',
			subscription: { status: 'trialing', quantity: 3 },
		});

		expect(toEvent(parsed('subscription.updated'), 'msg_3')).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'active', cancelAtPeriodEnd: true },
		});

		// 4. A `subscription.updated` carrying the canceled status is the revocation's echo — a retried or late one
		//    must not re-announce the subscription the `subscription.revoked` event already ended
		const late = { ...parsed('subscription.revoked'), type: 'subscription.updated' } as unknown as Parameters<
			typeof toEvent
		>[0];

		expect(toEvent(late, 'msg_3')).toBeNull();

		// 5. The specific subscription events repeat what `subscription.updated` already said
		expect(toEvent(parsed('subscription.active'), 'msg_4')).toBeNull();

		expect(toEvent(parsed('subscription.revoked'), 'msg_5')).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled', endedAt: new Date('2026-10-10T12:00:00Z') },
		});

		// 6. A paid order is the kit's paid invoice
		expect(toEvent(parsed('order.paid'), 'msg_6')).toMatchObject({ type: 'invoice.paid', invoice: { status: 'paid' } });

		// 7. The raw payload rides along for the audit trail
		expect(toEvent(parsed('order.paid'), 'msg_6')?.raw).toStrictEqual(parsed('order.paid'));
	});
});

describe('toCompletedCheckout', () => {
	test('Keeps the shape for a checkout the SDK types without a customer or a subscription', () => {
		// 1. The SDK's optional fields become the kit's empty id and `null`, so the event still has every key
		const event = parsed('checkout.updated');
		const checkout = event.type === 'checkout.updated' ? event.data : (undefined as never);

		expect(toCompletedCheckout({ ...checkout, customerId: null, subscriptionId: null })).toStrictEqual({
			id: 'b2a1c0d9-6666-4f66-8b66-000000000006',
			customerId: '',
			subscriptionId: null,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});
});

describe('deliveryIdOf', () => {
	test('Reads the Standard Webhooks id and answers nothing without it', () => {
		// 1. The header is the one value Polar keeps stable across retries, so it is what the kit deduplicates on
		expect(deliveryIdOf({ 'webhook-id': 'msg_1', 'webhook-timestamp': '1' })).toBe('msg_1');
		expect(deliveryIdOf({})).toBeUndefined();
	});
});
