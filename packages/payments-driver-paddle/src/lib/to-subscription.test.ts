/**
 * Tests of `to-subscription`: how a Paddle subscription — from the API or a notification — becomes the kit's
 * subscription, read from the fixtures in the shape of Paddle's notification payloads.
 */
import { describe, expect, test } from 'vitest';
import { parsed } from '../fixtures/index.js';
import { toSubscription } from './to-subscription.js';

describe('toSubscription', () => {
	test('Maps a subscription: the first item’s price and quantity, the period, a scheduled cancellation', () => {
		// 1. The updated fixture carries a scheduled cancellation, so every field of the shape is exercised at once
		expect(toSubscription(parsed('subscription.updated').data as never)).toStrictEqual({
			id: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s',
			customerId: 'ctm_01h7zcgmdc8n1v3ypn6pkqtb3r',
			status: 'active',
			priceId: 'pri_01gsz8x8sawmvhz1pv30nge1ke',
			productId: 'pro_01gsz4t5hdjse780zja8vvr7jg',
			quantity: 3,
			interval: 'month',
			currentPeriodStart: new Date('2026-09-01T10:00:00.000Z'),
			currentPeriodEnd: new Date('2026-10-01T10:00:00.000Z'),
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000Z'),
			canceledAt: null,
			trialEnd: null,
			endedAt: null,
			metadata: { organizationId: 'org_123', planId: 'pro', period: 'monthly' },
		});
	});

	test('A canceled subscription is over: canceledAt doubles as endedAt', () => {
		// 1. Paddle records no end date of its own, so the cancellation date is the end and the period is gone
		expect(toSubscription(parsed('subscription.canceled').data as never)).toMatchObject({
			status: 'canceled',
			canceledAt: new Date('2026-10-01T10:00:00.000Z'),
			endedAt: new Date('2026-10-01T10:00:00.000Z'),
			currentPeriodStart: null,
			cancelAtPeriodEnd: false,
		});
	});

	test('Refuses an unknown status and a subscription without items', () => {
		// 1. A valid subscription with one field broken isolates each refusal to that field
		const data = parsed('subscription.created').data as never as Record<string, unknown>;

		// 2. A status the map does not know and an empty item list are named in the error, not guessed at
		expect(() => toSubscription({ ...data, status: 'frozen' } as never)).toThrow('unknown status');
		expect(() => toSubscription({ ...data, items: [] } as never)).toThrow('no items');
	});
});
