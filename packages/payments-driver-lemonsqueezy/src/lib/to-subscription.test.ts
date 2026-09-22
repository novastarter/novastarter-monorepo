/**
 * Tests of `to-subscription`: how a Lemon Squeezy subscription, read from fixtures in the shape of its documented
 * payloads, becomes the kit's subscription — the statuses, the grace period, the seats.
 */
import { describe, expect, test } from 'vitest';
import { fixture } from '../fixtures/index.js';
import type { LsSubscriptionAttributes, LsWebhookPayload } from '../types.js';
import { toSubscription } from './to-subscription.js';

/**
 * The subscription of a fixture, named after the Lemon Squeezy event it carries.
 *
 * @param name - The fixture.
 * @returns The subscription resource under `data`.
 */
const subscriptionOf = (name: string): LsWebhookPayload<LsSubscriptionAttributes>['data'] =>
	fixture<LsSubscriptionAttributes>(name).data;

describe('toSubscription', () => {
	test('Maps a subscription: the variant as the price, the first item’s seats, the renewal as the period end', () => {
		// 1. Every field of the kit's shape, so a field silently dropped or renamed on either side shows up
		expect(
			toSubscription(subscriptionOf('subscription_created'), { interval: 'month', metadata: { a: 'b' } }),
		).toStrictEqual({
			id: '3001',
			customerId: '987',
			status: 'active',
			priceId: '222',
			productId: '111',
			quantity: 3,
			interval: 'month',
			currentPeriodStart: null,
			currentPeriodEnd: new Date('2026-10-01T10:00:00.000000Z'),
			cancelAtPeriodEnd: false,
			cancelAt: null,
			canceledAt: null,
			trialEnd: null,
			endedAt: null,
			metadata: { a: 'b' },
		});
	});

	test('A cancelled subscription is active on its grace period; an expired one is over', () => {
		// 1. `cancelled` is paid for until `ends_at`: the kit's `active` with `cancelAtPeriodEnd`, cancelled when it
		//    was last updated
		expect(toSubscription(subscriptionOf('subscription_cancelled'), { interval: 'month' })).toMatchObject({
			status: 'active',
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-01T10:00:00.000000Z'),
			canceledAt: new Date('2026-09-15T12:00:00.000000Z'),
			endedAt: null,
		});

		// 2. `expired` is the one that is over: the kit's `canceled`, ended at `ends_at`
		expect(toSubscription(subscriptionOf('subscription_expired'), { interval: 'month' })).toMatchObject({
			status: 'canceled',
			cancelAtPeriodEnd: false,
			endedAt: new Date('2026-10-01T10:00:00.000000Z'),
		});
	});

	test('Refuses an unknown status', () => {
		// 1. A status the map does not know is a change on Lemon Squeezy's side: loud, naming the status
		const data = subscriptionOf('subscription_created');
		const frozen = { ...data, attributes: { ...data.attributes, status: 'frozen' } };

		expect(() => toSubscription(frozen as never, { interval: 'month' })).toThrow('unknown status');
	});
});
