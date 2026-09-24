/**
 * Tests of `memory/limiter/types`: the shared configuration of the rate limiter, type-only.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { LimiterDriverConfigBase } from './types.js';
import * as types from './types.js';

test('ships no runtime code', () => {
	// Types only: nothing here may end up in a consumer's bundle
	expect(Object.keys(types)).toEqual([]);
});

test('the base config is the budget of a key', () => {
	// Every backend takes the same two numbers: how many points a key may spend, and the window in whole seconds after
	// which they are restored
	expectTypeOf<LimiterDriverConfigBase>().toEqualTypeOf<{ duration: number; points: number }>();

	const config: LimiterDriverConfigBase = { duration: 60, points: 10 };

	expect(config.points).toBe(10);
});
