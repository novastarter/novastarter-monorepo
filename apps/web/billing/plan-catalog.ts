import { InvalidConfigError, InvalidPayloadError } from '@novastarter/errors';
import type { BillingPeriod, EntitlementValue, Plan } from './plans';

/**
 * Where a provider's price id points in the catalog.
 */
export interface PlanPriceMatch {
	plan: Plan;
	period: BillingPeriod;
}

/**
 * The app's plans, validated, with the lookups the billing module needs.
 *
 * Built by `definePlans()`; never constructed by hand. `plans` is a plain array in the order the app listed them —
 * the order the pricing page shows — and safe to hand to a client component as data.
 */
export class PlanCatalog {
	/** The plans, in the order given. */
	readonly plans: readonly Plan[];

	/**
	 * The plans keyed by id, for the lookups.
	 *
	 * @internal
	 */
	private readonly byId: Map<string, Plan>;

	/**
	 * Create the catalog over plans that already passed validation.
	 *
	 * @param plans - Plans already validated by `definePlans()`.
	 */
	constructor(plans: readonly Plan[]) {
		// Keep the array as given for the pricing page, and index it once for every lookup by id
		this.plans = plans;
		this.byId = new Map(plans.map((plan) => [plan.id, plan]));
	}

	/**
	 * A plan by id.
	 *
	 * @param id - The plan's id.
	 * @returns The plan.
	 * @throws InvalidPayloadError for an id no plan has — a stale subscription row or a typo in a link, either worth surfacing.
	 */
	get(id: string): Plan {
		// Name the known ids in the error, so a typo is spotted without opening the plan file
		const plan = this.byId.get(id);

		if (!plan) {
			throw new InvalidPayloadError({ reason: `Plan "${id}" is not defined; known plans: ${this.ids().join(', ')}` });
		}

		return plan;
	}

	/**
	 * A plan by id, or nothing.
	 *
	 * @param id - The plan's id.
	 * @returns The plan, or `undefined`.
	 */
	find(id: string): Plan | undefined {
		// The non-throwing form of `get()`, for callers that treat an unknown id as "no plan"
		return this.byId.get(id);
	}

	/**
	 * Whether a plan exists.
	 *
	 * @param id - The plan's id.
	 * @returns `true` when a plan of that id is defined.
	 */
	has(id: string): boolean {
		return this.byId.has(id);
	}

	/**
	 * The plan ids, in order.
	 *
	 * @returns The ids, in the order the plans were given.
	 */
	ids(): string[] {
		// Read from the array, not the map, so the order is the pricing page's
		return this.plans.map((plan) => plan.id);
	}

	/**
	 * The free plan: the first one without a price, which is what an organization is on before it buys anything.
	 *
	 * @returns The free plan, or `undefined` when every plan costs money.
	 */
	get free(): Plan | undefined {
		// `isFree` was derived at validation, so this is a scan for a flag rather than a look at the prices
		return this.plans.find((plan) => plan.isFree);
	}

	/**
	 * The provider's price id to check out a plan for a period.
	 *
	 * @param planId - The plan.
	 * @param period - Monthly or yearly.
	 * @param provider - The driver name of the location doing the checkout (`lemonsqueezy`).
	 * @returns The id as configured in the plan's `providerIds`.
	 * @throws InvalidPayloadError when the plan has no price for the period — it is not sold that way.
	 * @throws InvalidConfigError when the plan has no id for the provider — the plan file is incomplete for the provider
	 * in use.
	 */
	priceIdOf(planId: string, period: BillingPeriod, provider: string): string {
		// An unknown plan throws from `get()` with the known ids
		const plan = this.get(planId);

		// A period without a price has nothing to check out, whatever the provider ids say
		if (!plan.prices[period]) {
			throw new InvalidPayloadError({ reason: `Plan "${planId}" has no ${period} price` });
		}

		// The provider id is what the checkout sends; missing, the plan file lacks the provider in use
		const id = plan.providerIds[provider]?.[period];

		if (!id) {
			throw new InvalidConfigError({
				reason: `Plan "${planId}" has no ${period} price id for provider "${provider}" in its providerIds — add it to the plan definitions`,
			});
		}

		return id;
	}

	/**
	 * The plan and period a provider's price id belongs to — how a webhook's subscription is mapped back to a plan.
	 *
	 * @param provider - The driver name (`lemonsqueezy`).
	 * @param priceId - The provider's id as it appears on the subscription.
	 * @returns The match, or `undefined` for a price the catalog does not list (a price created in the provider's
	 * dashboard but not in the plan file, say).
	 */
	findByPriceId(provider: string, priceId: string): PlanPriceMatch | undefined {
		// A linear scan is enough: a catalog has a handful of plans, and validation made the ids unique per provider
		for (const plan of this.plans) {
			const ids = plan.providerIds[provider];

			if (!ids) continue;

			for (const period of ['monthly', 'yearly'] as const) {
				if (ids[period] === priceId) return { plan, period };
			}
		}

		// `undefined` rather than an error: a webhook for an unlisted price is the caller's decision to log or drop
		return undefined;
	}

	/**
	 * What a plan grants for a key.
	 *
	 * @param planId - The plan.
	 * @param key - The entitlement (`seats`, `sso`).
	 * @returns A number (a limit), `null` (no limit), a boolean (a switch), or `undefined` when the plan does not
	 * mention the key — read that as "not granted".
	 */
	entitlement(planId: string, key: string): EntitlementValue | undefined {
		// An unknown plan throws; an unknown key answers `undefined`, which the gate reads as not granted
		return this.get(planId).entitlements[key];
	}

	/**
	 * Every entitlement key any plan mentions, so a gate can be checked for a key nobody defines.
	 *
	 * @returns The distinct keys, in order of first appearance.
	 */
	entitlementKeys(): string[] {
		// A Set drops the duplicates while keeping the order the plans list the keys in
		return [...new Set(this.plans.flatMap((plan) => Object.keys(plan.entitlements)))];
	}
}
