/**
 * Tests of the Stripe subscription mapping, read from fixtures shaped like Stripe's current subscriptions.
 */
import { readFileSync } from 'node:fs';
import type Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { STRIPE_STATUSES, toSubscription } from './to-subscription.js';

/**
 * A fixture event's object, as the subscription the event carries.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The subscription.
 */
const fixture = (name: string): Stripe.Subscription =>
	(JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Stripe.Event).data
		.object as Stripe.Subscription;

describe('toSubscription', () => {
	test('Reads the item for price, seats and the period, the subscription for the rest', () => {
		// 1. The updated fixture has every date set, so each one is checked as a `Date` from Stripe's seconds
		expect(toSubscription(fixture('customer.subscription.updated'))).toStrictEqual({
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
		// 1. Each of Stripe's statuses is one of the kit's; none is refused or renamed
		const subscription = fixture('customer.subscription.created');

		for (const status of STRIPE_STATUSES) {
			expect(toSubscription({ ...subscription, status: status as Stripe.Subscription.Status })).toMatchObject({
				status,
			});
		}
	});

	test('Refuses a subscription without items or with a status it does not know', () => {
		// 1. Without an item there is no price, no seat count and no period to read
		const subscription = fixture('customer.subscription.created');

		expect(() => toSubscription({ ...subscription, items: { ...subscription.items, data: [] } })).toThrow(
			'has no items',
		);

		// 2. A status the kit does not know means Stripe changed something the mapping has to learn — better loud
		expect(() => toSubscription({ ...subscription, status: 'frozen' as never })).toThrow('unknown status "frozen"');
	});
});
