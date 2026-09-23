/**
 * Tests of `feature-flags/lib/evaluate`: the switch, the lists and the rollout.
 */
import { describe, expect, test } from 'vitest';
import type { FeatureFlagDefinition } from '../types.js';
import { evaluateFeatureFlag } from './evaluate.js';
import { bucketOf } from './percentage.js';

/**
 * A flag with the given rules, enabled unless said otherwise.
 *
 * @param rules - The rules.
 * @param enabled - The switch.
 * @returns The definition.
 */
const flag = (rules: FeatureFlagDefinition['rules'], enabled = true): FeatureFlagDefinition => {
	// 1. One key for every case, so the rollout buckets found by the tests below are the ones evaluated
	return { key: 'new-billing', enabled, rules };
};

/**
 * Candidate ids to find one inside and one outside a 50 % rollout of `new-billing`.
 *
 * @internal
 */
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

describe('evaluateFeatureFlag', () => {
	test('A disabled flag is off for everyone, an enabled one without rules on for everyone', () => {
		// 1. The switch wins over any rule
		expect(evaluateFeatureFlag(flag(null, false), { user: 'u1' })).toBe(false);
		expect(evaluateFeatureFlag(flag({ users: ['u1'] }, false), { user: 'u1' })).toBe(false);

		// 2. No rules, or rules that name nobody, restrict nobody
		expect(evaluateFeatureFlag(flag(null), {})).toBe(true);
		expect(evaluateFeatureFlag(flag(undefined), {})).toBe(true);
		expect(evaluateFeatureFlag(flag({}), { user: 'u1' })).toBe(true);
		expect(evaluateFeatureFlag(flag({ users: [], organizations: [] }), {})).toBe(true);
	});

	test('Lists of users and organizations let the listed in and nobody else', () => {
		const definition = flag({ users: ['u1'], organizations: ['o1'] });

		// 1. Either list is a way in
		expect(evaluateFeatureFlag(definition, { user: 'u1' })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: 'u2', organization: 'o1' })).toBe(true);

		// 2. Anyone else, anonymous callers included, stays out
		expect(evaluateFeatureFlag(definition, { user: 'u2', organization: 'o2' })).toBe(false);
		expect(evaluateFeatureFlag(definition, {})).toBe(false);
		expect(evaluateFeatureFlag(definition, { user: null, organization: null })).toBe(false);
	});

	test('A percentage rollout buckets the user first, else the organization', () => {
		const definition = flag({ percentage: 50 });
		const inside = ids.find((id) => bucketOf('new-billing', id) < 50)!;
		const outside = ids.find((id) => bucketOf('new-billing', id) >= 50)!;

		// 1. The user's bucket decides, even with an organization that would land elsewhere
		expect(evaluateFeatureFlag(definition, { user: inside })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: outside })).toBe(false);
		expect(evaluateFeatureFlag(definition, { user: inside, organization: outside })).toBe(true);

		// 2. Without a user, the organization is the subject
		expect(evaluateFeatureFlag(definition, { organization: inside })).toBe(true);

		// 3. Nobody to bucket: off
		expect(evaluateFeatureFlag(definition, {})).toBe(false);

		// 4. The edges
		expect(evaluateFeatureFlag(flag({ percentage: 0 }), { user: inside })).toBe(false);
		expect(evaluateFeatureFlag(flag({ percentage: 100 }), { user: outside })).toBe(true);
	});

	test('A list and a percentage combine as alternatives', () => {
		const definition = flag({ users: ['vip'], percentage: 0 });

		// 1. The listed user is in although the rollout lets in nobody
		expect(evaluateFeatureFlag(definition, { user: 'vip' })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: 'other' })).toBe(false);
	});
});
