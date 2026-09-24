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
	// One key for every case, so the rollout buckets found by the tests below are the ones evaluated
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
		expect(evaluateFeatureFlag(flag(null, false), { user: 'u1' })).toBe(false);
		expect(evaluateFeatureFlag(flag({ users: ['u1'] }, false), { user: 'u1' })).toBe(false);

		expect(evaluateFeatureFlag(flag(null), {})).toBe(true);
		expect(evaluateFeatureFlag(flag(undefined), {})).toBe(true);
		expect(evaluateFeatureFlag(flag({}), { user: 'u1' })).toBe(true);
		expect(evaluateFeatureFlag(flag({ users: [], organizations: [] }), {})).toBe(true);
	});

	test('Lists of users and organizations let the listed in and nobody else', () => {
		const definition = flag({ users: ['u1'], organizations: ['o1'] });

		expect(evaluateFeatureFlag(definition, { user: 'u1' })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: 'u2', organization: 'o1' })).toBe(true);

		expect(evaluateFeatureFlag(definition, { user: 'u2', organization: 'o2' })).toBe(false);
		expect(evaluateFeatureFlag(definition, {})).toBe(false);
		expect(evaluateFeatureFlag(definition, { user: null, organization: null })).toBe(false);
	});

	test('A percentage rollout buckets the user first, else the organization', () => {
		const definition = flag({ percentage: 50 });
		const inside = ids.find((id) => bucketOf('new-billing', id) < 50)!;
		const outside = ids.find((id) => bucketOf('new-billing', id) >= 50)!;

		expect(evaluateFeatureFlag(definition, { user: inside })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: outside })).toBe(false);
		expect(evaluateFeatureFlag(definition, { user: inside, organization: outside })).toBe(true);

		expect(evaluateFeatureFlag(definition, { organization: inside })).toBe(true);

		expect(evaluateFeatureFlag(definition, {})).toBe(false);

		expect(evaluateFeatureFlag(flag({ percentage: 0 }), { user: inside })).toBe(false);
		expect(evaluateFeatureFlag(flag({ percentage: 100 }), { user: outside })).toBe(true);
	});

	test('A list and a percentage combine as alternatives', () => {
		const definition = flag({ users: ['vip'], percentage: 0 });

		expect(evaluateFeatureFlag(definition, { user: 'vip' })).toBe(true);
		expect(evaluateFeatureFlag(definition, { user: 'other' })).toBe(false);
	});
});
