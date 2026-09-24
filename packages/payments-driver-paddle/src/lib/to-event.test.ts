/**
 * Tests of `to-event`: which Paddle notifications become the kit's events and which are dropped, read from the
 * fixtures in the shape of Paddle's notification payloads.
 */
import { Webhooks } from '@paddle/paddle-node-sdk';
import { describe, expect, test } from 'vitest';
import { fixtureText, parsed } from '../fixtures/index.js';
import { toEvent } from './to-event.js';

describe('toEvent', () => {
	test('Maps the subscription and transaction events, drops the rest', () => {
		// A created subscription carries the event's own id and time, and the subscription mapped in full
		expect(toEvent(parsed('subscription.created'))).toMatchObject({
			id: 'evt_01h7zcgmdc8n1v3ypn6pkqtb5a',
			type: 'subscription.created',
			provider: 'paddle',
			occurredAt: new Date('2026-09-01T10:00:05.100Z'),
			subscription: { id: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s', status: 'active' },
		});

		// Every change of an existing subscription is one `subscription.updated`, the status telling them apart
		expect(toEvent(parsed('subscription.updated'))).toMatchObject({ type: 'subscription.updated' });

		expect(toEvent(parsed('subscription.past_due'))).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'past_due' },
		});

		// A cancellation is the kit's deletion, the subscription still attached so the app can close it out
		expect(toEvent(parsed('subscription.canceled'))).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled' },
		});

		// Transactions are the invoices: completed is paid, a failed payment is a failed invoice still open
		expect(toEvent(parsed('transaction.completed'))).toMatchObject({
			type: 'invoice.paid',
			invoice: { id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t', status: 'paid' },
		});

		expect(toEvent(parsed('transaction.payment_failed'))).toMatchObject({
			type: 'invoice.failed',
			invoice: { id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3z', status: 'open' },
		});

		// A verified event of a type the kit does not track is dropped rather than refused
		expect(toEvent(parsed('customer.updated'))).toBeNull();
	});

	test('Drops a subscription.updated that carries the canceled status', () => {
		// Paddle fires subscription.updated with status canceled alongside subscription.canceled for one
		// cancellation; the canceled event owns the deletion, so the update must not arrive as a change
		const body = JSON.parse(fixtureText('subscription.updated')) as Parameters<typeof Webhooks.fromJson>[0] & {
			data: { status: string };
		};

		body.data.status = 'canceled';

		expect(toEvent(Webhooks.fromJson(body))).toBeNull();
	});
});
