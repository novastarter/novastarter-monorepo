/**
 * Tests of the Stripe subscription mapping, read from fixtures shaped like Stripe's current subscriptions.
 */
import type Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { fixture } from '../fixtures/index.js';
import { STRIPE_STATUSES, toSubscription } from './to-subscription.js';

/**
 * A fixture event's object, as the subscription the event carries.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The subscription.
 */
const subscriptionOf = (name: string): Stripe.Subscription => fixture(name).data.object as Stripe.Subscription;

describe('toSubscription', () => {
	test('Reads the item for price, seats and the period, the subscription for the rest', () => {
		// The updated fixture has every date set, so each one is checked as a `Date` from Stripe's seconds.
		expect(toSubscription(subscriptionOf('customer.subscription.updated'))).toStrictEqual({
			id: 'sub_1S5abcDEF123456789',
			customerId: 'cus_T1abcDEF12345',
			status: 'active',
			priceId: 'price_pro_monthly',
			productId: 'prod_T1pro',
			quantity: 5,
			interval: 'month',
			currentPeriodStart: new Date(1789084800 * 1000),
			currentPeriodEnd: new Date(1791676800 * 1000),
			cancelAtPeriodEnd: true,
			cancelAt: new Date(1791676800 * 1000),
			canceledAt: new Date(1790000000 * 1000),
			trialEnd: new Date(1790294400 * 1000),
			endedAt: null,
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});

	test('Accepts every status Stripe reports', () => {
		const subscription = subscriptionOf('customer.subscription.created');

		for (const status of STRIPE_STATUSES) {
			expect(toSubscription({ ...subscription, status: status as Stripe.Subscription.Status })).toMatchObject({
				status,
			});
		}
	});

	test('Refuses a subscription without items or with a status it does not know', () => {
		const subscription = subscriptionOf('customer.subscription.created');

		expect(() => toSubscription({ ...subscription, items: { ...subscription.items, data: [] } })).toThrow(
			'has no items',
		);

		// A status the kit does not know means Stripe changed something the mapping has to learn.
		expect(() => toSubscription({ ...subscription, status: 'frozen' as never })).toThrow('unknown status "frozen"');
	});

	test('Falls back to the subscription-level period of a delivery pinned to an older API version', () => {
		// Before API version 2025-03-31 the period lives on the subscription, not the item: an endpoint pinned to an
		// earlier version receives deliveries of that shape, and the period must map instead of failing silently.
		const subscription = subscriptionOf('customer.subscription.updated');
		const [item] = subscription.items.data;

		const legacy = {
			...subscription,
			items: {
				...subscription.items,
				data: [{ ...item, current_period_start: undefined, current_period_end: undefined }],
			},
			current_period_start: 1789084800,
			current_period_end: 1791676800,
		} as unknown as Stripe.Subscription;

		expect(toSubscription(legacy)).toMatchObject({
			currentPeriodStart: new Date(1789084800 * 1000),
			currentPeriodEnd: new Date(1791676800 * 1000),
		});
	});
});
