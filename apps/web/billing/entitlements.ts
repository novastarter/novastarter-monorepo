import { useLogger } from '@novastarter/logger';
import type { BusDriver, CacheDriver } from '@novastarter/memory';
import { toError } from '@novastarter/utils';
import { LimitExceededError, ResourceRestrictedError } from './errors';
import type { PlanCatalog } from './plan-catalog';
import type { EntitlementValue } from './plans';

/**
 * How many of something an organization has — members for `seats`, rows for `projects`. Registered per limit key
 * by the module that owns the data.
 *
 * @param organizationId - The organization.
 * @returns The current usage.
 */
export type UsageCounter = (organizationId: string) => Promise<number> | number;

/**
 * Whether an organization currently uses a switched feature — has SSO configured, say. Registered per switch key by
 * the module that owns the feature, so a plan that no longer grants it can be told from one that never did.
 *
 * @param organizationId - The organization.
 * @returns `true` when the feature is in use.
 */
export type FeatureValidator = (organizationId: string) => Promise<boolean> | boolean;

/**
 * Where an organization's plan comes from: `organization.planId` in the app, kept by the webhook sync.
 *
 * @param organizationId - The organization.
 * @returns The plan id, or `null` for an organization on no paid plan.
 */
export type PlanResolver = (organizationId: string) => Promise<string | null> | string | null;

/**
 * The outcome of a check.
 */
export interface EntitlementCheck {
	/** The entitlement key. */
	key: string;
	/** A `limit` is counted against a number, a `switch` is on or off. */
	kind: 'limit' | 'switch';
	/** Whether the operation — or the feature — is within the plan. */
	allowed: boolean;
	/** The plan's limit; `null` when there is none (an unlimited limit, or a switch that is on). */
	limit: number | null;
	/** The usage counted, or `1` / `0` for a switch in use / not in use. */
	used: number;
	/** What is left under the limit; `null` when there is no limit. */
	remaining: number | null;
	/** The plan the check ran against. */
	planId: string | null;
}

/**
 * What {@link EntitlementManager.check} takes besides the key.
 */
export interface CheckOptions {
	/** Units about to be added — a member about to be invited counts as one seat. */
	adding?: number | undefined;
	/** Units about to be removed; a pure removal is always allowed, so an organization over its limit can shrink. */
	removing?: number | undefined;
	/** Skip the cache and count now — inside a transaction, or right after a write. */
	fresh?: boolean | undefined;
}

/**
 * What {@link EntitlementManager} is built with.
 */
export interface EntitlementManagerOptions {
	/** The plan catalog: what each plan grants. */
	plans: PlanCatalog;
	/** How an organization's plan is found. */
	resolvePlan: PlanResolver;
	/** Where usage and plans are remembered between checks; nothing is cached without one. */
	cache?: CacheDriver | undefined;
	/** How other processes hear about an invalidation; local only without one. */
	bus?: BusDriver | undefined;
	/** The bus channel; {@link ENTITLEMENTS_CHANNEL} unless given. */
	channel?: string | undefined;
}

/**
 * The bus channel invalidations travel on.
 *
 * @defaultValue `entitlements.invalidate`
 */
export const ENTITLEMENTS_CHANNEL = 'entitlements.invalidate';

/**
 * What an invalidation message carries: which organization, and which keys — none meaning every key.
 */
export interface InvalidateMessage {
	organizationId: string;
	keys?: string[] | undefined;
}

/**
 * Whether an organization may do what its plan says — the gate every limited feature goes through.
 *
 * The plan comes from the catalog through {@link PlanResolver}; the usage from a {@link UsageCounter} the owning
 * module registers per key; a switched feature's current use from a {@link FeatureValidator}. Both are cached per
 * organization and key in a `@novastarter/memory` cache, and dropped by `clearCache()` — locally, and on every
 * other process through the bus. A `fork(planId)` answers the same questions for another plan without touching the
 * organization: what an upgrade would grant, what a downgrade would break.
 *
 * @example
 * ```ts
 * const entitlements = new EntitlementManager({
 * 	plans,
 * 	resolvePlan,
 * 	cache,
 * 	bus,
 * });
 *
 * entitlements.registerCounter('seats', (organizationId) => countMembers(organizationId));
 *
 * const { allowed, limit, used } = await entitlements.check(organizationId, 'seats', { adding: 1 });
 *
 * // throws LimitExceededError when the seat would go over the plan
 * await entitlements.assert(organizationId, 'seats', { adding: 1 });
 * ```
 */
export class EntitlementManager {
	/**
	 * The catalog: what each plan grants.
	 *
	 * @internal
	 */
	private readonly plans: PlanCatalog;

	/**
	 * How an organization's plan is found.
	 *
	 * @internal
	 */
	private readonly resolvePlan: PlanResolver;

	/**
	 * Where plans and usage are remembered between checks; nothing is cached without one.
	 *
	 * @internal
	 */
	private readonly cache: CacheDriver | undefined;

	/**
	 * How other processes hear about an invalidation; local only without one.
	 *
	 * @internal
	 */
	private readonly bus: BusDriver | undefined;

	/**
	 * The bus channel invalidations travel on.
	 *
	 * @internal
	 */
	private readonly channel: string;

	/**
	 * Usage counters by limit key; shared with forks, so usage is counted once.
	 *
	 * @internal
	 */
	private counters: Map<string, UsageCounter> = new Map();

	/**
	 * Feature validators by switch key; shared with forks.
	 *
	 * @internal
	 */
	private validators: Map<string, FeatureValidator> = new Map();

	/**
	 * Whether `initialize()` subscribed to the bus already, so a second call is a no-op.
	 *
	 * Set before the subscription awaits and reset when it fails, so a refused subscription never leaves the flag
	 * true with nothing subscribed; inherited by forks, which share the subscription and must not add a second one.
	 *
	 * @internal
	 */
	private subscribed = false;

	/**
	 * Whether `planOf()` may cache — off in a fork, whose plan is a preview and must not be written for everyone.
	 *
	 * @internal
	 */
	private cachePlan = true;

	/**
	 * Create the gate over a catalog, with the cache and bus it may use.
	 *
	 * @param options - Catalog, plan resolver, cache and bus.
	 */
	constructor(options: EntitlementManagerOptions) {
		this.plans = options.plans;
		this.resolvePlan = options.resolvePlan;
		this.cache = options.cache;
		this.bus = options.bus;
		this.channel = options.channel ?? ENTITLEMENTS_CHANNEL;
	}

	/**
	 * Listen for invalidations from other processes; a no-op without a bus, and idempotent.
	 *
	 * A refused subscription resets the flag and rethrows, so a later call retries instead of silently staying
	 * unsubscribed; the flag is set before the await only to keep a concurrent second call from subscribing twice.
	 *
	 * @returns When subscribed.
	 * @throws The error the bus refused the subscription with.
	 */
	async initialize(): Promise<void> {
		// Start-up may call this more than once; one subscription is enough.
		if (this.subscribed || !this.bus) return;

		// Set before the await so a concurrent call waits instead of subscribing twice; the catch below resets the flag
		// on a refusal, so it never stays true with no subscription behind it
		this.subscribed = true;

		try {
			// Only the local copy is cleared, without publishing again, so the message does not echo across nodes.
			await this.bus.subscribe<InvalidateMessage>(this.channel, (message) => {
				// The bus waits for no handler: the delete runs detached, and a failure is logged rather than left as
				// an unhandled rejection that can take the process down
				void this.clearCacheLocally(message.organizationId, message.keys).catch((error: unknown) => {
					useLogger().error(
						toError(error),
						`Failed to clear the entitlement cache of "${message.organizationId}" after a bus invalidation`,
					);
				});
			});
		} catch (error) {
			// The subscription never happened, so the flag must not claim it — the next start-up subscribes again
			this.subscribed = false;
			throw error;
		}
	}

	/**
	 * Wire up how a limit's usage is counted.
	 *
	 * @param key - The entitlement key (`seats`).
	 * @param counter - The counter.
	 * @throws Error when a counter for the key exists already — two modules claiming one key is a bug.
	 */
	registerCounter(key: string, counter: UsageCounter): void {
		// A second counter would silently replace the first; failing points at the module that registered twice
		if (this.counters.has(key)) {
			throw new Error(`EntitlementManager: a counter is already registered for entitlement "${key}"`);
		}

		this.counters.set(key, counter);
	}

	/**
	 * Wire up how a switch's current use is told.
	 *
	 * @param key - The entitlement key (`sso`).
	 * @param validator - The validator.
	 * @throws Error when a validator for the key exists already.
	 */
	registerValidator(key: string, validator: FeatureValidator): void {
		// Same rule as the counters: one owner per key
		if (this.validators.has(key)) {
			throw new Error(`EntitlementManager: a validator is already registered for entitlement "${key}"`);
		}

		this.validators.set(key, validator);
	}

	/**
	 * The keys with a counter or a validator, so a check of everything knows what can be checked.
	 *
	 * @returns The distinct keys, counters first.
	 */
	registeredKeys(): string[] {
		// A key may have both a counter and a validator; the Set lists it once
		return [...new Set([...this.counters.keys(), ...this.validators.keys()])];
	}

	/**
	 * The plan an organization is on: the resolver's, when the catalog knows it, else the free plan.
	 *
	 * @param organizationId - The organization.
	 * @param fresh - Skip the cache.
	 * @returns The plan id, or `null` when there is neither a plan nor a free one.
	 */
	async planOf(organizationId: string, fresh = false): Promise<string | null> {
		// A fork never caches its plan: it is a preview, and the cache is shared with the real manager
		const key = planCacheKey(organizationId);
		const cache = this.cachePlan ? this.cache : undefined;

		// The cached answer is a string, or `''` for "none", since a cache cannot tell `null` from a miss.
		if (!fresh && cache) {
			const cached = await cache.get<string>(key);

			if (typeof cached === 'string') return cached === '' ? null : cached;
		}

		// A plan the catalog no longer lists (removed from the plan file) falls back to the free one.
		const resolved = await this.resolvePlan(organizationId);
		const planId = (resolved !== null && this.plans.has(resolved) ? resolved : this.plans.free?.id) ?? null;

		// Remember the answer under the same encoding the read expects
		if (cache) await cache.set(key, planId ?? '');

		return planId;
	}

	/**
	 * What the organization's plan grants for a key.
	 *
	 * @param organizationId - The organization.
	 * @param key - The entitlement key.
	 * @returns The value, or `undefined` when the plan does not mention the key — not granted.
	 */
	async entitlementOf(organizationId: string, key: string): Promise<EntitlementValue | undefined> {
		// No plan at all — not even a free one — grants nothing
		const planId = await this.planOf(organizationId);

		return planId === null ? undefined : this.plans.entitlement(planId, key);
	}

	/**
	 * How much of a limit an organization uses, through the key's counter — cached until invalidated.
	 *
	 * @param organizationId - The organization.
	 * @param key - The entitlement key.
	 * @param fresh - Skip the cache.
	 * @returns The usage; `0` for a key without a counter, since nothing counts it.
	 */
	async getUsage(organizationId: string, key: string, fresh = false): Promise<number> {
		// A key nobody counts uses nothing, so a limit on it is never exceeded
		const counter = this.counters.get(key);

		if (!counter) return 0;

		// A caller asks for `fresh` right after a write, when the cached count is stale.
		const cacheKey = usageCacheKey(organizationId, key);

		if (!fresh && this.cache) {
			const cached = await this.cache.get<number>(cacheKey);

			if (typeof cached === 'number') return cached;
		}

		const used = await counter(organizationId);

		if (this.cache) await this.cache.set(cacheKey, used);

		return used;
	}

	/**
	 * Whether an organization currently uses a switched feature, through the key's validator — cached until
	 * invalidated.
	 *
	 * @param organizationId - The organization.
	 * @param key - The entitlement key.
	 * @param fresh - Skip the cache.
	 * @returns `true` when in use; `false` for a key without a validator.
	 */
	async isInUse(organizationId: string, key: string, fresh = false): Promise<boolean> {
		// A key nobody validates is never "in use", so a downgrade never flags it
		const validator = this.validators.get(key);

		if (!validator) return false;

		// A key may carry a counter and a validator at once, so the switch state caches in a slot of its own; sharing
		// the usage slot would have the two overwrite each other.
		const cacheKey = switchCacheKey(organizationId, key);

		if (!fresh && this.cache) {
			const cached = await this.cache.get<boolean>(cacheKey);

			if (typeof cached === 'boolean') return cached;
		}

		const inUse = await validator(organizationId);

		if (this.cache) await this.cache.set(cacheKey, inUse);

		return inUse;
	}

	/**
	 * Whether an organization is within its plan for a key — the non-throwing form of {@link assert}.
	 *
	 * A limit compares the counted usage plus what is about to be added, minus what is about to be removed, against
	 * the plan's number; `null` in the plan is no limit. A switch is allowed when the plan grants it. A key the plan
	 * does not mention is not granted: a limit of zero, a switch that is off.
	 *
	 * @param organizationId - The organization.
	 * @param key - The entitlement key.
	 * @param options - What is about to change, and whether to skip the cache.
	 * @returns The check.
	 */
	async check(organizationId: string, key: string, options: CheckOptions = {}): Promise<EntitlementCheck> {
		const planId = await this.planOf(organizationId, options.fresh);
		const value = planId === null ? undefined : this.plans.entitlement(planId, key);
		const adding = options.adding ?? 0;
		const removing = options.removing ?? 0;

		// The usage of a switch feeds the downgrade preview.
		if (typeof value === 'boolean' || (value === undefined && this.validators.has(key))) {
			const allowed = value === true;
			const used = (await this.isInUse(organizationId, key, options.fresh)) ? 1 : 0;

			return { key, kind: 'switch', allowed, limit: allowed ? null : 0, used, remaining: null, planId };
		}

		// The usage is still counted, for the pages that show it.
		if (value === null) {
			const used = await this.getUsage(organizationId, key, options.fresh);

			return { key, kind: 'limit', allowed: true, limit: null, used, remaining: null, planId };
		}

		// A key the plan leaves out is a limit of zero. A pure removal is allowed even over the limit, so an
		// organization that outgrew a downgraded plan can always shrink back.
		const limit = typeof value === 'number' ? value : 0;
		const used = await this.getUsage(organizationId, key, options.fresh);
		const allowed = (adding === 0 && removing > 0) || used + adding - removing <= limit;

		return { key, kind: 'limit', allowed, limit, used, remaining: Math.max(0, limit - used), planId };
	}

	/**
	 * Throw when an organization is not within its plan for a key.
	 *
	 * @param organizationId - The organization.
	 * @param key - The entitlement key.
	 * @param options - What is about to change.
	 * @returns The check, when it passed.
	 * @throws LimitExceededError (403) for a limit that would be exceeded.
	 * @throws ResourceRestrictedError (403) for a switch the plan does not grant.
	 */
	async assert(organizationId: string, key: string, options: CheckOptions = {}): Promise<EntitlementCheck> {
		const result = await this.check(organizationId, key, options);

		if (result.allowed) return result;

		// Two error classes, so a transport layer can word a limit and a missing feature differently.
		if (result.kind === 'limit') {
			throw new LimitExceededError({ category: key });
		}

		throw new ResourceRestrictedError({ category: key });
	}

	/**
	 * Every registered key at once — what a downgrade preview lists: limits exceeded by the current usage, switches
	 * in use that the plan would not grant.
	 *
	 * @param organizationId - The organization.
	 * @param options - Whether to skip the cache.
	 * @returns One check per registered key; `allowed` is `false` for a switch in use without the grant.
	 */
	async checkAll(organizationId: string, options: Pick<CheckOptions, 'fresh'> = {}): Promise<EntitlementCheck[]> {
		// The keys are independent, so they are checked in parallel
		return Promise.all(
			this.registeredKeys().map(async (key) => {
				// Nothing is about to change: the preview asks about the current usage alone
				const result = await this.check(organizationId, key, options);

				// A switch that is off is only a problem when the organization uses the feature
				if (result.kind === 'switch' && !result.allowed && result.used === 0) {
					return { ...result, allowed: true };
				}

				return result;
			}),
		);
	}

	/**
	 * Forget what is cached for an organization — everything, or the given keys — here and in every other process.
	 *
	 * The billing module calls it when a subscription changes (the plan) and when the counted rows change (a member
	 * joined: `seats`).
	 *
	 * @param organizationId - The organization.
	 * @param keys - The keys to drop; every key and the plan unless given.
	 * @returns When cleared and published.
	 */
	async clearCache(organizationId: string, keys?: string[]): Promise<void> {
		// This process first, so the caller's next read is fresh even before the bus delivers
		await this.clearCacheLocally(organizationId, keys);

		// The other processes hear the same message `initialize()` subscribed them to
		if (this.bus) {
			await this.bus.publish<InvalidateMessage>(this.channel, { organizationId, keys });
		}
	}

	/**
	 * A manager that answers for another plan — an upgrade or a downgrade the organization is looking at — with
	 * this one's counters, validators and cache, so the usage is not counted twice.
	 *
	 * Read-only by intent: the fork shares the cache, so `clearCache()` on it clears for everyone. It also shares the
	 * bus subscription: `initialize()` on a fork is a no-op once the original subscribed — one callback per bus, not
	 * one per manager — but a fork made before the original subscribed subscribes on its own first call.
	 *
	 * @param planId - The plan to answer for; `null` for no plan (the free one).
	 * @returns The fork.
	 */
	fork(planId: string | null): EntitlementManager {
		// The resolver is the only thing that changes: it answers the preview plan for every organization
		const forked = new EntitlementManager({
			plans: this.plans,
			resolvePlan: () => planId,
			cache: this.cache,
			bus: this.bus,
			channel: this.channel,
		});

		// Usage is shared through the same cache and counters; the plan is the fork's own and never cached
		forked.counters = this.counters;
		forked.validators = this.validators;
		forked.cachePlan = false;

		// The fork rides the original's bus subscription; copying the flag keeps its initialize from attaching a second
		// callback that would clear the same cache twice
		forked.subscribed = this.subscribed;

		return forked;
	}

	/**
	 * Drop cached entries without telling other processes.
	 *
	 * @param organizationId - The organization.
	 * @param keys - The keys; every key and the plan unless given.
	 * @internal
	 */
	private async clearCacheLocally(organizationId: string, keys?: string[]): Promise<void> {
		if (!this.cache) return;

		// A key may carry both a count and a switch state, so both slots of every target key go. Without keys the plan
		// goes too, since it is what a subscription change alters.
		const targets = keys
			? keys.flatMap((key) => [usageCacheKey(organizationId, key), switchCacheKey(organizationId, key)])
			: [
					planCacheKey(organizationId),
					...this.registeredKeys().flatMap((key) => [
						usageCacheKey(organizationId, key),
						switchCacheKey(organizationId, key),
					]),
				];

		await Promise.all(targets.map((target) => this.cache!.delete(target)));
	}
}

/**
 * The cache key of an organization's plan.
 *
 * @param organizationId - The organization.
 * @returns The key.
 */
export const planCacheKey = (organizationId: string): string => `plan:${organizationId}`;

/**
 * The cache key of an organization's usage of an entitlement.
 *
 * @param organizationId - The organization.
 * @param key - The entitlement key.
 * @returns The key.
 */
export const usageCacheKey = (organizationId: string, key: string): string => `usage:${organizationId}:${key}`;

/**
 * The cache key of an organization's switch state of an entitlement.
 *
 * A key may carry a counter and a validator at once, so the switch state cannot share the usage slot — the two
 * would overwrite each other and the cache would never hold.
 *
 * @param organizationId - The organization.
 * @param key - The entitlement key.
 * @returns The key.
 */
export const switchCacheKey = (organizationId: string, key: string): string => `switch:${organizationId}:${key}`;
