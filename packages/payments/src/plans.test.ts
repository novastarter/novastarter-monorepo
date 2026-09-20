/**
 * Tests of `payments/plans` and `lib/plan-catalog`: what `definePlans()` accepts, what it refuses, and the lookups.
 */
import { describe, expect, test } from 'vitest';
import { PlanCatalog } from './lib/plan-catalog.js';
import { definePlans, type PlanDefinition } from './plans.js';

const usd = (amount: number) => ({ amount, currency: 'usd' });

const definitions: PlanDefinition[] = [
	{ id: 'free', name: 'Free', prices: {}, entitlements: { seats: 1, projects: 1, sso: false } },
	{
		id: 'pro',
		name: 'Pro',
		description: 'For small teams',
		prices: { monthly: usd(1900), yearly: usd(19000) },
		providerIds: {
			stripe: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
			polar: { monthly: 'prod_pro_m', yearly: 'prod_pro_y' },
		},
		entitlements: { seats: 5, projects: 10, sso: false },
		trialDays: 14,
		highlighted: true,
	},
	{
		id: 'business',
		name: 'Business',
		prices: { monthly: usd(4900) },
		providerIds: { stripe: { monthly: 'price_biz_m' } },
		entitlements: { seats: 25, projects: null, sso: true },
	},
];

describe('definePlans', () => {
	test('Builds a catalog in the given order, with provider ids filled in and the free flag derived', () => {
		const catalog = definePlans(definitions);

		expect(catalog).toBeInstanceOf(PlanCatalog);
		expect(catalog.ids()).toStrictEqual(['free', 'pro', 'business']);
		expect(catalog.get('free')).toMatchObject({ isFree: true, providerIds: {} });
		expect(catalog.get('pro')).toMatchObject({ isFree: false, trialDays: 14, highlighted: true });
		expect(catalog.free?.id).toBe('free');
		expect(catalog.has('business')).toBe(true);
		expect(catalog.find('enterprise')).toBeUndefined();

		expect(() => catalog.get('enterprise')).toThrow(
			'Plan "enterprise" is not defined; known plans: free, pro, business',
		);
	});

	test('Refuses malformed definitions with a message naming the field', () => {
		expect(() => definePlans([{ ...definitions[0]!, id: 'Free Plan' }])).toThrow(/Invalid plan definitions[\s\S]*id/);

		expect(() =>
			definePlans([{ ...definitions[1]!, prices: { monthly: { amount: 19.99, currency: 'usd' } } }]),
		).toThrow(/prices\.monthly\.amount/);

		expect(() => definePlans([{ ...definitions[1]!, prices: { monthly: { amount: 1900, currency: 'USD' } } }])).toThrow(
			/ISO 4217/,
		);

		expect(() => definePlans([{ ...definitions[0]!, entitlements: { 'Seat Count': 1 } }])).toThrow(/entitlements/);
		expect(() => definePlans([{ ...definitions[0]!, entitlements: { seats: -1 } }])).toThrow(/entitlements\.seats/);
		expect(() => definePlans([{ ...definitions[0]!, trialDays: 1.5 }])).toThrow(/trialDays/);
	});

	test('Refuses duplicate ids, provider ids without a price and a price id used twice', () => {
		expect(() => definePlans([definitions[0]!, definitions[0]!])).toThrow('plan "free" is defined twice');

		expect(() =>
			definePlans([{ ...definitions[2]!, providerIds: { stripe: { monthly: 'price_biz_m', yearly: 'price_biz_y' } } }]),
		).toThrow('plan "business" has a yearly price id for "stripe" but no yearly price');

		expect(() =>
			definePlans([definitions[1]!, { ...definitions[2]!, providerIds: { stripe: { monthly: 'price_pro_m' } } }]),
		).toThrow('"stripe" price id "price_pro_m" is used by both "pro" and "business"');

		// 1. The same id under two providers is fine: the lookup is per provider
		expect(() =>
			definePlans([{ ...definitions[2]!, providerIds: { stripe: { monthly: 'x' }, polar: { monthly: 'x' } } }]),
		).not.toThrow();
	});
});

describe('PlanCatalog', () => {
	const catalog = definePlans(definitions);

	test('Resolves the provider price id of a plan and period, and complains when it is missing', () => {
		expect(catalog.priceIdOf('pro', 'yearly', 'stripe')).toBe('price_pro_y');
		expect(catalog.priceIdOf('pro', 'monthly', 'polar')).toBe('prod_pro_m');
		expect(() => catalog.priceIdOf('business', 'yearly', 'stripe')).toThrow('Plan "business" has no yearly price');

		expect(() => catalog.priceIdOf('business', 'monthly', 'polar')).toThrow(
			'Plan "business" has no monthly price id for provider "polar" in its providerIds',
		);

		expect(() => catalog.priceIdOf('free', 'monthly', 'stripe')).toThrow('Plan "free" has no monthly price');
	});

	test('Maps a provider price id back to its plan and period', () => {
		expect(catalog.findByPriceId('stripe', 'price_pro_y')).toMatchObject({ plan: { id: 'pro' }, period: 'yearly' });
		expect(catalog.findByPriceId('polar', 'prod_pro_m')).toMatchObject({ plan: { id: 'pro' }, period: 'monthly' });
		expect(catalog.findByPriceId('stripe', 'prod_pro_m')).toBeUndefined();
		expect(catalog.findByPriceId('paddle', 'price_pro_m')).toBeUndefined();
	});

	test('Reads entitlements: limits, no limit, switches, and absence', () => {
		expect(catalog.entitlement('pro', 'seats')).toBe(5);
		expect(catalog.entitlement('business', 'projects')).toBeNull();
		expect(catalog.entitlement('business', 'sso')).toBe(true);
		expect(catalog.entitlement('free', 'api')).toBeUndefined();
		expect(catalog.entitlementKeys()).toStrictEqual(['seats', 'projects', 'sso']);
	});

	test('Exposes the plans as plain data', () => {
		expect(JSON.parse(JSON.stringify(catalog.plans))).toHaveLength(3);
		expect(catalog.plans[1]?.prices.yearly).toStrictEqual(usd(19000));
	});
});
