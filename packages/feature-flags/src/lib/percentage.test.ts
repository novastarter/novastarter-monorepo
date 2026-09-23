/**
 * Tests of `feature-flags/lib/percentage`: stable, even and per-flag rollout buckets.
 */
import { describe, expect, test } from 'vitest';
import { bucketOf, isInRollout } from './percentage.js';

/**
 * Ids of the shape a database hands out one after another, the case a weak hash spreads badly.
 *
 * @param count - How many ids.
 * @returns `u0`, `u1`, … `u<count - 1>`.
 */
const sequentialIds = (count: number): string[] => {
	// 1. A short prefix and a counter, the ids that differ in the last characters only
	return Array.from({ length: count }, (_, index) => `u${index}`);
};

describe('bucketOf', () => {
	test('Is stable and within 0–99', () => {
		// 1. The same pair always lands in the same bucket, whatever the process
		expect(bucketOf('new-billing', 'u1')).toBe(bucketOf('new-billing', 'u1'));

		for (const id of sequentialIds(200)) {
			const bucket = bucketOf('new-billing', id);

			expect(bucket).toBeGreaterThanOrEqual(0);
			expect(bucket).toBeLessThan(100);
		}
	});

	test('Spreads sequential ids evenly', () => {
		// 1. A 10 % rollout over 10 000 sequential ids lets in close to 1 000 of them
		const inside = sequentialIds(10_000).filter((id) => bucketOf('new-billing', id) < 10).length;

		expect(inside).toBeGreaterThan(900);
		expect(inside).toBeLessThan(1100);
	});

	test('Shuffles the subjects between flags', () => {
		// 1. Another key puts the same ids in other buckets, so two rollouts do not pick the same people
		const same = sequentialIds(100).filter((id) => bucketOf('new-billing', id) === bucketOf('beta-ai', id));

		expect(same.length).toBeLessThan(10);
	});

	test('Picks independent subjects for two rollouts of keys of the same length', () => {
		// 1. Two 10 % rollouts over 10 000 ids overlap in about 1 % of them when independent — a polynomial string hash
		//    makes them disjoint or identical instead
		const both = sequentialIds(10_000).filter(
			(id) => bucketOf('new-billing', id) < 10 && bucketOf('old-billing', id) < 10,
		).length;

		expect(both).toBeGreaterThan(50);
		expect(both).toBeLessThan(150);
	});
});

describe('isInRollout', () => {
	test('Follows the bucket, with the edges short-circuited', () => {
		// 1. Nobody is in 0 %, everybody is in 100 %, whatever their bucket
		expect(isInRollout('f', 'x', 0)).toBe(false);
		expect(isInRollout('f', 'x', 100)).toBe(true);

		// 2. In between, the bucket decides
		expect(isInRollout('f', 'x', 50)).toBe(bucketOf('f', 'x') < 50);
	});

	test('Only adds subjects as the share grows', () => {
		// 1. Everyone inside 10 % stays inside 20 %, so widening a rollout never takes the feature away from anyone
		const at10 = sequentialIds(500).filter((id) => isInRollout('f', id, 10));

		expect(at10.every((id) => isInRollout('f', id, 20))).toBe(true);
	});
});
