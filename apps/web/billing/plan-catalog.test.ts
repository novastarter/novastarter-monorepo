/**
 * Tests of `billing/plan-catalog`: the lookups over the catalog `definePlans()` builds.
 */
import { describe, expect, test } from 'vitest';
import { definePlans, type PlanDefinition } from './plans';

/**
 * Builds a price in US cents.
 *
 * @param amount - The price in cents.
 * @returns The price object with `usd` currency.
 */
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

describe('PlanCatalog', () => {
	// 1. The catalog under test is built the way the app builds it: validated definitions in, lookups out
	const catalog = definePlans(definitions);

	test('Resolves the provider price id of a plan and period, and complains when it is missing', () => {
		// 1. A price id resolves for the plan and period that carry it, per provider
		expect(catalog.priceIdOf('pro', 'yearly', 'stripe')).toBe('price_pro_y');
		expect(catalog.priceIdOf('pro', 'monthly', 'polar')).toBe('prod_pro_m');

		// 2. A missing price, a missing provider id, and a free plan without prices are three distinct complaints
		expect(() => catalog.priceIdOf('business', 'yearly', 'stripe')).toThrow('Plan "business" has no yearly price');

		expect(() => catalog.priceIdOf('business', 'monthly', 'polar')).toThrow(
			'Plan "business" has no monthly price id for provider "polar" in its providerIds',
		);

		expect(() => catalog.priceIdOf('free', 'monthly', 'stripe')).toThrow('Plan "free" has no monthly price');
	});

	test('Maps a provider price id back to its plan and period', () => {
		// 1. The webhook's direction: a price id from the provider names the plan and period it belongs to
		expect(catalog.findByPriceId('stripe', 'price_pro_y')).toMatchObject({ plan: { id: 'pro' }, period: 'yearly' });
		expect(catalog.findByPriceId('polar', 'prod_pro_m')).toMatchObject({ plan: { id: 'pro' }, period: 'monthly' });

		// 2. An id of another provider, or one nobody uses, maps to nothing
		expect(catalog.findByPriceId('stripe', 'prod_pro_m')).toBeUndefined();
		expect(catalog.findByPriceId('paddle', 'price_pro_m')).toBeUndefined();
	});

	test('Reads entitlements: limits, no limit, switches, and absence', () => {
		// 1. A number is a limit, null is no limit, a boolean a switch; a key the plan omits is not granted
		expect(catalog.entitlement('pro', 'seats')).toBe(5);
		expect(catalog.entitlement('business', 'projects')).toBeNull();
		expect(catalog.entitlement('business', 'sso')).toBe(true);
		expect(catalog.entitlement('free', 'api')).toBeUndefined();

		// 2. The keys of every plan, in definition order
		expect(catalog.entitlementKeys()).toStrictEqual(['seats', 'projects', 'sso']);
	});

	test('Exposes the plans as plain data', () => {
		// 1. Serialization loses nothing: what pages render travels as data
		expect(JSON.parse(JSON.stringify(catalog.plans))).toHaveLength(3);
		expect(catalog.plans[1]?.prices.yearly).toStrictEqual(usd(19000));
	});
});
