/**
 * Tests of `payments/lib/entitlements`: limits, switches, the cache and its invalidation over the bus, and forks.
 */
import { LimitExceededError, ResourceRestrictedError } from '@novastarter/errors';
import { BusLocal, CacheLocal } from '@novastarter/memory';
import { describe, expect, test, vi } from 'vitest';
import { definePlans } from '../plans.js';
import { EntitlementManager, ENTITLEMENTS_CHANNEL, planCacheKey, usageCacheKey } from './entitlements.js';

const plans = definePlans([
	{ id: 'free', name: 'Free', prices: {}, entitlements: { seats: 1, projects: 1, sso: false } },
	{
		id: 'pro',
		name: 'Pro',
		prices: { monthly: { amount: 1900, currency: 'usd' } },
		entitlements: { seats: 5, projects: 10, sso: false },
	},
	{
		id: 'business',
		name: 'Business',
		prices: { monthly: { amount: 4900, currency: 'usd' } },
		entitlements: { seats: 25, projects: null, sso: true },
	},
]);

/**
 * A manager over an in-memory plan table and counters the test controls.
 *
 * @param options - Plans by organization, cache and bus.
 * @returns The manager and the spies.
 */
const setup = (options: { planOf?: Record<string, string | null>; cache?: boolean; bus?: boolean } = {}) => {
	const planTable: Record<string, string | null> = options.planOf ?? { org_1: 'pro' };
	const resolvePlan = vi.fn((organizationId: string) => planTable[organizationId] ?? null);
	const countSeats = vi.fn(async (organizationId: string): Promise<number> => (organizationId === 'org_1' ? 4 : 0));
	const ssoInUse = vi.fn(async () => false);

	const manager = new EntitlementManager({
		plans,
		resolvePlan,
		cache: options.cache ? new CacheLocal({}) : undefined,
		bus: options.bus ? new BusLocal() : undefined,
	});

	manager.registerCounter('seats', countSeats);
	manager.registerValidator('sso', ssoInUse);

	return { manager, resolvePlan, countSeats, ssoInUse, planTable };
};

describe('EntitlementManager', () => {
	test('Resolves the plan through the catalog, falling back to the free plan', async () => {
		const { manager } = setup({ planOf: { org_1: 'pro', org_2: null, org_3: 'legacy' } });

		expect(await manager.planOf('org_1')).toBe('pro');
		expect(await manager.planOf('org_2')).toBe('free');
		expect(await manager.planOf('org_3')).toBe('free');
		expect(await manager.entitlementOf('org_1', 'seats')).toBe(5);
		expect(await manager.entitlementOf('org_1', 'api')).toBeUndefined();
	});

	test('Checks a limit against the counted usage, with what is about to be added or removed', async () => {
		const { manager } = setup();

		expect(await manager.check('org_1', 'seats')).toStrictEqual({
			key: 'seats',
			kind: 'limit',
			allowed: true,
			limit: 5,
			used: 4,
			remaining: 1,
			planId: 'pro',
		});

		expect((await manager.check('org_1', 'seats', { adding: 1 })).allowed).toBe(true);
		expect((await manager.check('org_1', 'seats', { adding: 2 })).allowed).toBe(false);

		// 1. A key the plan does not mention is a limit of zero; a counter-less key counts as nothing
		expect(await manager.check('org_1', 'api')).toMatchObject({ kind: 'limit', allowed: true, limit: 0, used: 0 });
		expect((await manager.check('org_1', 'api', { adding: 1 })).allowed).toBe(false);
	});

	test('Lets an organization over its limit shrink, and never blocks an unlimited key', async () => {
		const { manager, countSeats } = setup({ planOf: { org_1: 'free' } });

		countSeats.mockResolvedValue(3);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ allowed: false, limit: 1, used: 3, remaining: 0 });
		expect((await manager.check('org_1', 'seats', { removing: 1 })).allowed).toBe(true);
		expect((await manager.check('org_1', 'seats', { adding: 1, removing: 1 })).allowed).toBe(false);

		const business = manager.fork('business');

		expect(await business.check('org_1', 'projects')).toMatchObject({ allowed: true, limit: null, remaining: null });
	});

	test('Checks a switch: on when the plan grants it, off with whether it is in use', async () => {
		const { manager, ssoInUse } = setup();

		expect(await manager.check('org_1', 'sso')).toStrictEqual({
			key: 'sso',
			kind: 'switch',
			allowed: false,
			limit: 0,
			used: 0,
			remaining: null,
			planId: 'pro',
		});

		ssoInUse.mockResolvedValue(true);

		expect(await manager.check('org_1', 'sso', { fresh: true })).toMatchObject({ allowed: false, used: 1 });
		expect(await manager.fork('business').check('org_1', 'sso')).toMatchObject({ allowed: true, limit: null, used: 1 });
	});

	test('Asserts with the errors the API answers with', async () => {
		const { manager } = setup();

		await expect(manager.assert('org_1', 'seats', { adding: 1 })).resolves.toMatchObject({ allowed: true });
		await expect(manager.assert('org_1', 'seats', { adding: 2 })).rejects.toBeInstanceOf(LimitExceededError);
		await expect(manager.assert('org_1', 'sso')).rejects.toBeInstanceOf(ResourceRestrictedError);
		await expect(manager.assert('org_1', 'sso')).rejects.toMatchObject({ status: 403 });
	});

	test('Caches the plan and the usage until cleared, and clears through the bus', async () => {
		const { manager, resolvePlan, countSeats, planTable } = setup({ cache: true, bus: true });

		await manager.initialize();
		await manager.initialize();

		await manager.check('org_1', 'seats');
		await manager.check('org_1', 'seats');

		// 1. Two checks, one read of each source
		expect(resolvePlan).toHaveBeenCalledTimes(1);
		expect(countSeats).toHaveBeenCalledTimes(1);

		// 2. The world changed: without an invalidation the cache still answers, with one the sources are read again
		planTable['org_1'] = 'business';
		countSeats.mockResolvedValue(9);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'pro', used: 4 });

		await manager.clearCache('org_1', ['seats']);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'pro', used: 9 });

		await manager.clearCache('org_1');

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'business', used: 9, limit: 25 });

		// 3. `fresh` bypasses the cache for one call and refreshes it
		countSeats.mockResolvedValue(10);
		expect((await manager.check('org_1', 'seats')).used).toBe(9);
		expect((await manager.check('org_1', 'seats', { fresh: true })).used).toBe(10);
		expect((await manager.check('org_1', 'seats')).used).toBe(10);
	});

	test('Drops a cached entry when another process publishes an invalidation', async () => {
		const bus = new BusLocal();
		const cache = new CacheLocal({});
		const countSeats = vi.fn(async () => 2);

		const manager = new EntitlementManager({ plans, resolvePlan: () => 'pro', cache, bus });

		manager.registerCounter('seats', countSeats);
		await manager.initialize();
		await manager.check('org_1', 'seats');

		expect(await cache.has(usageCacheKey('org_1', 'seats'))).toBe(true);
		expect(await cache.has(planCacheKey('org_1'))).toBe(true);

		// 1. What another node would publish
		await bus.publish(ENTITLEMENTS_CHANNEL, { organizationId: 'org_1' });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(await cache.has(usageCacheKey('org_1', 'seats'))).toBe(false);
		expect(await cache.has(planCacheKey('org_1'))).toBe(false);
	});

	test('Forks for another plan, sharing the usage but never caching the preview plan', async () => {
		const { manager, countSeats } = setup({ cache: true });

		await manager.check('org_1', 'seats');

		const preview = manager.fork('free');

		expect(await preview.check('org_1', 'seats')).toMatchObject({ planId: 'free', allowed: false, limit: 1, used: 4 });
		expect(countSeats).toHaveBeenCalledTimes(1);

		// 1. The organization's own plan is untouched by the preview
		expect(await manager.planOf('org_1')).toBe('pro');
		expect(await manager.fork(null).planOf('org_1')).toBe('free');
	});

	test('Checks every registered key at once, flagging only what a plan change would break', async () => {
		const { manager, countSeats, ssoInUse } = setup();

		countSeats.mockResolvedValue(3);
		ssoInUse.mockResolvedValue(false);

		const downgrade = await manager.fork('free').checkAll('org_1');

		// 1. Three members do not fit the free plan; SSO is off there but not in use, so it is not a problem
		expect(downgrade.map((check) => [check.key, check.allowed])).toStrictEqual([
			['seats', false],
			['sso', true],
		]);

		ssoInUse.mockResolvedValue(true);

		expect((await manager.fork('free').checkAll('org_1', { fresh: true })).map((check) => check.allowed)).toStrictEqual(
			[false, false],
		);
	});

	test('Refuses a second counter or validator for a key', () => {
		const { manager } = setup();

		expect(() => manager.registerCounter('seats', () => 0)).toThrow('already registered for entitlement "seats"');
		expect(() => manager.registerValidator('sso', () => false)).toThrow('already registered for entitlement "sso"');
		expect(manager.registeredKeys()).toStrictEqual(['seats', 'sso']);
	});
});
