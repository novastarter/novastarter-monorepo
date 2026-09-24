/**
 * Tests of `billing/entitlements`: limits, switches, the cache and its invalidation over the bus, and forks.
 */
import { type BusDriver, BusDriverLocal, CacheDriverLocal } from '@novastarter/memory';
import { describe, expect, test, vi } from 'vitest';
import { EntitlementManager, ENTITLEMENTS_CHANNEL, planCacheKey, switchCacheKey, usageCacheKey } from './entitlements';
import { LimitExceededError, ResourceRestrictedError } from './errors';
import { definePlans } from './plans';

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
		cache: options.cache ? new CacheDriverLocal({}) : undefined,
		bus: options.bus ? new BusDriverLocal() : undefined,
	});

	// Every test checks a limit and a switch.
	manager.registerCounter('seats', countSeats);
	manager.registerValidator('sso', ssoInUse);

	return { manager, resolvePlan, countSeats, ssoInUse, planTable };
};

describe('EntitlementManager', () => {
	test('Resolves the plan through the catalog, falling back to the free plan', async () => {
		const { manager } = setup({ planOf: { org_1: 'pro', org_2: null, org_3: 'legacy' } });

		// A known plan resolves; no plan at all, or one the catalog no longer lists, falls back to the free one
		expect(await manager.planOf('org_1')).toBe('pro');
		expect(await manager.planOf('org_2')).toBe('free');
		expect(await manager.planOf('org_3')).toBe('free');

		// The entitlement comes from the resolved plan; a key the plan omits is not granted
		expect(await manager.entitlementOf('org_1', 'seats')).toBe(5);
		expect(await manager.entitlementOf('org_1', 'api')).toBeUndefined();
	});

	test('Checks a limit against the counted usage, with what is about to be added or removed', async () => {
		const { manager } = setup();

		// Four of the five seats the pro plan grants: the full shape of one check
		expect(await manager.check('org_1', 'seats')).toStrictEqual({
			key: 'seats',
			kind: 'limit',
			allowed: true,
			limit: 5,
			used: 4,
			remaining: 1,
			planId: 'pro',
		});

		// What is about to be added decides the allowance: one more seat fits, two do not
		expect((await manager.check('org_1', 'seats', { adding: 1 })).allowed).toBe(true);
		expect((await manager.check('org_1', 'seats', { adding: 2 })).allowed).toBe(false);

		// A key the plan does not mention is a limit of zero; a counter-less key counts as nothing
		expect(await manager.check('org_1', 'api')).toMatchObject({ kind: 'limit', allowed: true, limit: 0, used: 0 });
		expect((await manager.check('org_1', 'api', { adding: 1 })).allowed).toBe(false);
	});

	test('Lets an organization over its limit shrink, and never blocks an unlimited key', async () => {
		const { manager, countSeats } = setup({ planOf: { org_1: 'free' } });

		// Three members on the one-seat free plan: over the limit, with a pure removal still allowed
		countSeats.mockResolvedValue(3);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ allowed: false, limit: 1, used: 3, remaining: 0 });
		expect((await manager.check('org_1', 'seats', { removing: 1 })).allowed).toBe(true);
		expect((await manager.check('org_1', 'seats', { adding: 1, removing: 1 })).allowed).toBe(false);

		// A fork for the business plan answers for its unlimited key — a preview, not a plan change
		const business = manager.fork('business');

		expect(await business.check('org_1', 'projects')).toMatchObject({ allowed: true, limit: null, remaining: null });
	});

	test('Checks a switch: on when the plan grants it, off with whether it is in use', async () => {
		const { manager, ssoInUse } = setup();

		// The pro plan does not grant SSO, and the feature is not in use
		expect(await manager.check('org_1', 'sso')).toStrictEqual({
			key: 'sso',
			kind: 'switch',
			allowed: false,
			limit: 0,
			used: 0,
			remaining: null,
			planId: 'pro',
		});

		// In use or not, the switch stays disallowed without the grant — the usage is reported either way
		ssoInUse.mockResolvedValue(true);

		expect(await manager.check('org_1', 'sso', { fresh: true })).toMatchObject({ allowed: false, used: 1 });

		// The business fork grants the switch: allowed, with the usage still counted for the preview
		expect(await manager.fork('business').check('org_1', 'sso')).toMatchObject({ allowed: true, limit: null, used: 1 });
	});

	test('Asserts with the errors the API answers with', async () => {
		const { manager } = setup();

		// Within the plan the check passes through; over the limit or ungranted, the API-shaped error throws
		await expect(manager.assert('org_1', 'seats', { adding: 1 })).resolves.toMatchObject({ allowed: true });
		await expect(manager.assert('org_1', 'seats', { adding: 2 })).rejects.toBeInstanceOf(LimitExceededError);
		await expect(manager.assert('org_1', 'sso')).rejects.toBeInstanceOf(ResourceRestrictedError);

		// A refusal is a 403 the transport layer answers with
		await expect(manager.assert('org_1', 'sso')).rejects.toMatchObject({ status: 403 });
	});

	test('Caches the plan and the usage until cleared, and clears through the bus', async () => {
		const { manager, resolvePlan, countSeats, planTable } = setup({ cache: true, bus: true });

		// Two initialize calls subscribe once; the first check populates the cache
		await manager.initialize();
		await manager.initialize();

		await manager.check('org_1', 'seats');
		await manager.check('org_1', 'seats');

		// Two checks, one read of each source — the second answer came from the cache
		expect(resolvePlan).toHaveBeenCalledTimes(1);
		expect(countSeats).toHaveBeenCalledTimes(1);

		// The world changed: without an invalidation the cache still answers, with one the sources are read again
		planTable['org_1'] = 'business';
		countSeats.mockResolvedValue(9);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'pro', used: 4 });

		await manager.clearCache('org_1', ['seats']);

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'pro', used: 9 });

		await manager.clearCache('org_1');

		expect(await manager.check('org_1', 'seats')).toMatchObject({ planId: 'business', used: 9, limit: 25 });

		// `fresh` bypasses the cache for one call and refreshes it
		countSeats.mockResolvedValue(10);
		expect((await manager.check('org_1', 'seats')).used).toBe(9);
		expect((await manager.check('org_1', 'seats', { fresh: true })).used).toBe(10);
		expect((await manager.check('org_1', 'seats')).used).toBe(10);
	});

	test('Drops a cached entry when another process publishes an invalidation', async () => {
		const bus = new BusDriverLocal();
		const cache = new CacheDriverLocal({});
		const countSeats = vi.fn(async () => 2);

		const manager = new EntitlementManager({ plans, resolvePlan: () => 'pro', cache, bus });

		manager.registerCounter('seats', countSeats);
		await manager.initialize();
		await manager.check('org_1', 'seats');

		expect(await cache.has(usageCacheKey('org_1', 'seats'))).toBe(true);
		expect(await cache.has(planCacheKey('org_1'))).toBe(true);

		// What another node would publish drops both entries on this one
		await bus.publish(ENTITLEMENTS_CHANNEL, { organizationId: 'org_1' });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(await cache.has(usageCacheKey('org_1', 'seats'))).toBe(false);
		expect(await cache.has(planCacheKey('org_1'))).toBe(false);
	});

	test('Caches a limit and a switch of the same key in separate slots', async () => {
		// A key with both a counter and a validator — the shape registeredKeys() documents
		const cache = new CacheDriverLocal({});
		const countApi = vi.fn(async () => 7);
		const apiInUse = vi.fn(async () => true);

		const manager = new EntitlementManager({ plans, resolvePlan: () => 'pro', cache });

		manager.registerCounter('api', countApi);
		manager.registerValidator('api', apiInUse);

		// Both kinds cache under their own slot, so neither clobbers the other
		expect(await manager.getUsage('org_1', 'api')).toBe(7);
		expect(await manager.isInUse('org_1', 'api')).toBe(true);
		expect(await cache.get(usageCacheKey('org_1', 'api'))).toBe(7);
		expect(await cache.get(switchCacheKey('org_1', 'api'))).toBe(true);

		// Two more reads come from the cache: both sources ran once
		await manager.getUsage('org_1', 'api');
		await manager.isInUse('org_1', 'api');

		expect(countApi).toHaveBeenCalledTimes(1);
		expect(apiInUse).toHaveBeenCalledTimes(1);

		// An invalidation of the key drops both slots
		await manager.clearCache('org_1', ['api']);

		expect(await cache.has(usageCacheKey('org_1', 'api'))).toBe(false);
		expect(await cache.has(switchCacheKey('org_1', 'api'))).toBe(false);
	});

	test('Retries the subscription when the bus refuses it, instead of staying silently unsubscribed', async () => {
		// A bus whose first subscription the backend refuses — what a failed Redis SUBSCRIBE looks like
		const subscribe = vi.fn<BusDriver['subscribe']>(() => Promise.resolve());
		subscribe.mockRejectedValueOnce(new Error('refused'));
		const bus = { subscribe } as unknown as BusDriver;
		const manager = new EntitlementManager({ plans, resolvePlan: () => null, bus });

		// The refusal reaches the caller, and the failed call must not mark the manager subscribed
		await expect(manager.initialize()).rejects.toThrow('refused');

		// The next start-up subscribes again; once settled, further initialize calls are the no-op they should be
		await manager.initialize();
		await manager.initialize();

		expect(subscribe).toHaveBeenCalledTimes(2);
	});

	test('Subscribes a fork no second time on the bus the original is subscribed to', async () => {
		const subscribe = vi.fn<BusDriver['subscribe']>(() => Promise.resolve());
		const bus = { subscribe } as unknown as BusDriver;
		const manager = new EntitlementManager({ plans, resolvePlan: () => null, bus });

		// The original subscribes once; the fork shares bus and subscription, so its initialize adds nothing
		await manager.initialize();
		await manager.fork('pro').initialize();

		expect(subscribe).toHaveBeenCalledTimes(1);
	});

	test('Forks for another plan, sharing the usage but never caching the preview plan', async () => {
		const { manager, countSeats } = setup({ cache: true });

		// One check on the real manager, so the fork's read of the same usage comes from the shared cache
		await manager.check('org_1', 'seats');

		// The fork answers for the free plan — one seat, four used — without counting a second time
		const preview = manager.fork('free');

		expect(await preview.check('org_1', 'seats')).toMatchObject({ planId: 'free', allowed: false, limit: 1, used: 4 });
		expect(countSeats).toHaveBeenCalledTimes(1);

		// The organization's own plan is untouched by the preview
		expect(await manager.planOf('org_1')).toBe('pro');
		expect(await manager.fork(null).planOf('org_1')).toBe('free');
	});

	test('Checks every registered key at once, flagging only what a plan change would break', async () => {
		const { manager, countSeats, ssoInUse } = setup();

		// Three seats used and SSO off: the state the downgrade preview is asked about
		countSeats.mockResolvedValue(3);
		ssoInUse.mockResolvedValue(false);

		const downgrade = await manager.fork('free').checkAll('org_1');

		// Three members do not fit the free plan; SSO is off there but not in use, so it is not a problem
		expect(downgrade.map((check) => [check.key, check.allowed])).toStrictEqual([
			['seats', false],
			['sso', true],
		]);

		// SSO in use changes the answer: the switch the free plan does not grant is a problem too
		ssoInUse.mockResolvedValue(true);

		expect((await manager.fork('free').checkAll('org_1', { fresh: true })).map((check) => check.allowed)).toStrictEqual(
			[false, false],
		);
	});

	test('Refuses a second counter or validator for a key', () => {
		const { manager } = setup();

		// A second registration for a key fails, naming the entitlement and its kind
		expect(() => manager.registerCounter('seats', () => 0)).toThrow('already registered for entitlement "seats"');
		expect(() => manager.registerValidator('sso', () => false)).toThrow('already registered for entitlement "sso"');

		// The first registrations stand
		expect(manager.registeredKeys()).toStrictEqual(['seats', 'sso']);
	});
});
