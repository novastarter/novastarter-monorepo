import { z } from 'zod';
import { PlanCatalog } from './lib/plan-catalog.js';
import type { Money } from './types.js';

/**
 * The periods a plan can be bought for.
 */
export type BillingPeriod = 'monthly' | 'yearly';

/**
 * The periods, for iteration.
 *
 * @defaultValue `monthly`, `yearly`
 */
export const BILLING_PERIODS: readonly BillingPeriod[] = ['monthly', 'yearly'];

/**
 * What a plan grants for one key: a limit (`seats: 5`), no limit (`projects: null`), or a switch (`sso: true`).
 */
export type EntitlementValue = number | boolean | null;

/**
 * A plan's price for one period.
 */
export type PlanPrice = Money;

/**
 * Something given per period, each period optional.
 *
 * @typeParam T - What a period holds.
 */
export type PerPeriod<T> = { [Period in BillingPeriod]?: T | undefined };

/**
 * The provider's ids of a plan's prices, per period — a Stripe price id, a Polar product id.
 */
export type ProviderPriceIds = PerPeriod<string>;

/**
 * A plan as the app writes it in its plan file.
 */
export interface PlanDefinition {
	/** Stable id stored on subscriptions: `free`, `pro`, `business`. Lower-case letters, digits and dashes. */
	id: string;
	/** Shown on the pricing page. */
	name: string;
	description?: string | undefined;
	/** What it costs per period; empty for a free plan. */
	prices: PerPeriod<PlanPrice>;
	/** The ids the providers know the prices by, per driver name: `{ lemonsqueezy: { monthly: '222' } }`. */
	providerIds?: Record<string, ProviderPriceIds> | undefined;
	/** What the plan grants, by key. A key a plan leaves out is not granted. */
	entitlements: Record<string, EntitlementValue>;
	/** Days of free trial a checkout of this plan starts with. */
	trialDays?: number | undefined;
	/** Whether the pricing page singles this plan out. */
	highlighted?: boolean | undefined;
}

/**
 * A plan after validation: the definition with its optional parts filled in and the derived flags.
 */
export interface Plan extends PlanDefinition {
	providerIds: Record<string, ProviderPriceIds>;
	/** `true` when the plan has no price at all. */
	isFree: boolean;
}

/**
 * The shape of an id: lower-case letters, digits, dashes, starting with a letter.
 *
 * @defaultValue `/^[a-z][a-z0-9-]*$/`
 */
export const PLAN_ID_PATTERN: RegExp = /^[a-z][a-z0-9-]*$/;

/**
 * The shape of an entitlement key: a lower-case identifier, so it reads as a key in env, JSON and code alike.
 *
 * @defaultValue `/^[a-z][a-z0-9_]*$/`
 */
export const ENTITLEMENT_KEY_PATTERN: RegExp = /^[a-z][a-z0-9_]*$/;

/**
 * One price: a non-negative whole number of minor units in a three-letter, lower-case currency.
 */
export const planPriceSchema: z.ZodType<PlanPrice> = z.object({
	amount: z.number().int().nonnegative(),
	currency: z
		.string()
		.length(3)
		.regex(/^[a-z]{3}$/, 'an ISO 4217 code in lower case, like "usd"'),
});

/**
 * The provider's ids of a plan, per period.
 */
export const providerPriceIdsSchema: z.ZodType<ProviderPriceIds> = z.object({
	monthly: z.string().min(1).optional(),
	yearly: z.string().min(1).optional(),
});

/**
 * One plan definition, before the cross-plan checks.
 */
export const planDefinitionSchema: z.ZodType<PlanDefinition> = z.object({
	id: z.string().regex(PLAN_ID_PATTERN, 'lower-case letters, digits and dashes, starting with a letter'),
	name: z.string().min(1),
	description: z.string().optional(),
	prices: z.object({
		monthly: planPriceSchema.optional(),
		yearly: planPriceSchema.optional(),
	}),
	providerIds: z.record(z.string().regex(PLAN_ID_PATTERN, 'a driver name'), providerPriceIdsSchema).optional(),
	entitlements: z.record(
		z.string().regex(ENTITLEMENT_KEY_PATTERN, 'a lower-case identifier'),
		z.union([z.number().int().nonnegative(), z.boolean(), z.null()]),
	),
	trialDays: z.number().int().nonnegative().optional(),
	highlighted: z.boolean().optional(),
});

/**
 * Define the app's plans — the source of truth the pricing page, the checkout and the entitlement gates read.
 *
 * Each plan is checked on its own (ids, amounts, currencies, keys) and against the others: ids are unique, a
 * provider id is only given for a period that has a price, and a provider's price id points at one plan and one
 * period, since a webhook maps a subscription's price back to a plan by it. A mistake throws at import time, so the
 * app fails to start rather than sells a plan it cannot map.
 *
 * @param definitions - The plans, in the order the pricing page shows them.
 * @returns The catalog.
 * @throws Error describing every problem found.
 *
 * @example
 * ```ts
 * export const plans = definePlans([
 * 	{
 * 		id: 'free',
 * 		name: 'Free',
 * 		prices: {},
 * 		entitlements: {
 * 			seats: 1,
 * 			projects: 1,
 * 			sso: false,
 * 		},
 * 	},
 * 	{
 * 		id: 'pro',
 * 		name: 'Pro',
 * 		prices: {
 * 			monthly: {
 * 				amount: 1900,
 * 				currency: 'usd',
 * 			},
 * 			yearly: {
 * 				amount: 19000,
 * 				currency: 'usd',
 * 			},
 * 		},
 * 		providerIds: {
 * 			lemonsqueezy: {
 * 				monthly: '222',
 * 				yearly: '223',
 * 			},
 * 		},
 * 		entitlements: {
 * 			seats: 5,
 * 			projects: 10,
 * 			sso: false,
 * 		},
 * 		trialDays: 14,
 * 		highlighted: true,
 * 	},
 * ]);
 * ```
 */
export const definePlans = (definitions: readonly PlanDefinition[]): PlanCatalog => {
	// 1. Each definition on its own; every message names the plan by index and id, so a long file stays navigable
	const parsed = z.array(planDefinitionSchema).safeParse(definitions);

	if (!parsed.success) {
		throw new Error(`Invalid plan definitions:\n${z.prettifyError(parsed.error)}`);
	}

	// 2. The cross-plan checks collect every problem rather than throwing at the first, so one run reports them all
	const problems: string[] = [];
	const seenIds = new Set<string>();
	const seenPriceIds = new Map<string, string>();

	// 3. One pass fills in the optional parts and records what later plans must not repeat
	const plans: Plan[] = parsed.data.map((definition) => {
		// 1. Ids are what subscriptions store; two plans with one id could not be told apart
		if (seenIds.has(definition.id)) {
			problems.push(`plan "${definition.id}" is defined twice`);
		}

		seenIds.add(definition.id);

		// 2. Every provider id is checked against the prices and against the ids seen so far
		const providerIds = definition.providerIds ?? {};

		for (const [provider, ids] of Object.entries(providerIds)) {
			for (const period of BILLING_PERIODS) {
				const id = ids[period];

				if (id === undefined) continue;

				// 3. A provider id for a period without a price would sell something the catalog has no amount for
				if (!definition.prices[period]) {
					problems.push(`plan "${definition.id}" has a ${period} price id for "${provider}" but no ${period} price`);
				}

				// 4. Reverse lookup — price id → plan — only works when an id appears once per provider
				const key = `${provider}:${id}`;
				const owner = seenPriceIds.get(key);

				if (owner !== undefined) {
					problems.push(`"${provider}" price id "${id}" is used by both "${owner}" and "${definition.id}"`);
				}

				seenPriceIds.set(key, definition.id);
			}
		}

		// 5. `isFree` is derived once here, so no reader has to inspect the prices again
		return {
			...definition,
			providerIds,
			isFree: BILLING_PERIODS.every((period) => definition.prices[period] === undefined),
		};
	});

	// 4. One error listing every problem, so the plan file is fixed in one go
	if (problems.length > 0) {
		throw new Error(`Invalid plan definitions:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
	}

	// 5. The catalog is what the rest of the package reads; the plain array stays reachable as `catalog.plans`
	return new PlanCatalog(plans);
};
