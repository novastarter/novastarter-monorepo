/**
 * Tests of `to-subscription`: how a Polar subscription — from the API or a webhook — becomes the kit's subscription,
 * read from the fixtures through the SDK's own parser.
 */
import { describe, expect, test } from 'vitest';
import { parsed } from '../fixtures/index.js';
import { toSubscription } from './to-subscription.js';

describe('toSubscription', () => {
	test('Maps the product as the price, seats, the period and the cancellation dates', () => {
		// 1. The updated fixture carries a scheduled cancellation and a trial, so every field of the shape is exercised
		const event = parsed('subscription.updated');
		const subscription = toSubscription(event.type === 'subscription.updated' ? event.data : (undefined as never));

		expect(subscription).toStrictEqual({
			id: 'd9c8b7a6-5555-4e55-9a55-000000000005',
			customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
			status: 'active',
			priceId: 'a1b2c3d4-3333-4c33-9e33-000000000003',
			productId: 'a1b2c3d4-3333-4c33-9e33-000000000003',
			quantity: 5,
			interval: 'month',
			currentPeriodStart: new Date('2026-09-10T12:00:00Z'),
			currentPeriodEnd: new Date('2026-10-10T12:00:00Z'),
			cancelAtPeriodEnd: true,
			cancelAt: new Date('2026-10-10T12:00:00Z'),
			canceledAt: new Date('2026-09-20T12:00:00Z'),
			trialEnd: new Date('2026-09-24T12:00:00Z'),
			endedAt: null,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});

	test('Refuses a status it does not know', () => {
		// 1. A status outside Polar's documented set is a change on Polar's side, better loud than silently wrong
		const event = parsed('subscription.created');
		const subscription = event.type === 'subscription.created' ? event.data : (undefined as never);

		expect(() => toSubscription({ ...subscription, status: 'frozen' as never })).toThrow('unknown status "frozen"');
	});
});
