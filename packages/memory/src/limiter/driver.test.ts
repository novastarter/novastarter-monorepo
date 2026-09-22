/**
 * Tests of `memory/limiter/driver`: the contract every rate-limiter backend implements, type-only.
 */
import { expect, test } from 'vitest';
import type { LimiterDriver } from './driver.js';
import * as driver from './driver.js';

test('ships no runtime code', () => {
	// 1. The interface describes the backends; nothing here may end up in a consumer's bundle
	expect(Object.keys(driver)).toEqual([]);
});

test('a backend satisfies the contract with two methods', () => {
	// 1. Consuming a point and forgetting a key are the whole surface; `close` is the only optional member
	const backend: LimiterDriver = {
		consume: async (_key) => {},
		delete: async (_key) => {},
	};

	expect(backend.consume).toBeTypeOf('function');
});
