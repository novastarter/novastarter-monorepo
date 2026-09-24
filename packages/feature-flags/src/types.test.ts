/**
 * Tests of `feature-flags/types`: the schemas a driver validates definitions against.
 */
import { describe, expect, test } from 'vitest';
import { featureFlagDefinitionSchema, featureFlagKeySchema } from './types.js';

describe('featureFlagKeySchema', () => {
	test('Accepts lower-case keys with dashes and refuses the rest', () => {
		// The shape that reads the same in code, URLs and upper-cased variable names
		expect(featureFlagKeySchema.safeParse('new-billing').success).toBe(true);
		expect(featureFlagKeySchema.safeParse('beta2').success).toBe(true);

		expect(featureFlagKeySchema.safeParse('New-Billing').success).toBe(false);
		expect(featureFlagKeySchema.safeParse('2fa').success).toBe(false);
		expect(featureFlagKeySchema.safeParse('-billing').success).toBe(false);
		expect(featureFlagKeySchema.safeParse('new_billing').success).toBe(false);
		expect(featureFlagKeySchema.safeParse('').success).toBe(false);
		expect(featureFlagKeySchema.safeParse('a'.repeat(65)).success).toBe(false);
	});
});

describe('featureFlagDefinitionSchema', () => {
	test('Accepts a definition with or without rules', () => {
		// The rules are optional and nullable: both mean "on for everyone while enabled"
		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: true }).success).toBe(true);
		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: false, rules: null }).success).toBe(true);

		expect(
			featureFlagDefinitionSchema.safeParse({
				key: 'a',
				enabled: true,
				description: 'The new billing page',
				rules: { users: ['u1'], organizations: ['o1'], percentage: 25 },
			}).success,
		).toBe(true);
	});

	test('Refuses a percentage out of range or not whole, and empty ids', () => {
		// A rollout share is a whole percent of 0–100; anything else is a typo worth failing on
		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: true, rules: { percentage: 101 } }).success).toBe(
			false,
		);

		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: true, rules: { percentage: -1 } }).success).toBe(
			false,
		);

		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: true, rules: { percentage: 2.5 } }).success).toBe(
			false,
		);

		// An empty id names nobody — an empty id of a context never matches — so it can only be a typo
		expect(featureFlagDefinitionSchema.safeParse({ key: 'a', enabled: true, rules: { users: [''] } }).success).toBe(
			false,
		);
	});
});
