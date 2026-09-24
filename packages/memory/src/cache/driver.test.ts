/**
 * Tests of `memory/cache/driver`: the contract every cache backend implements, type-only.
 */
import { expect, test } from 'vitest';
import type { CacheDriver } from './driver.js';
import * as driver from './driver.js';

test('ships no runtime code', () => {
	// The interface describes the backends; nothing here may end up in a consumer's bundle
	expect(Object.keys(driver)).toEqual([]);
});

test('a backend satisfies the contract with always-asynchronous methods', () => {
	// The cache is what a `KvDriver` is without the numeric helpers and without the synchronous answers, so a backend
	// returns promises from every method; `close` is the only optional member
	const backend: CacheDriver = {
		get: async (_key) => undefined,
		set: async (_key, _value) => {},
		delete: async (_key) => {},
		has: async (_key) => false,
		clear: async () => {},
		acquireLock: async (_key) => ({
			release: async () => {},
			extend: async (_duration) => {},
		}),
		usingLock: async (_key, callback) => callback(),
	};

	expect(backend.get).toBeTypeOf('function');
});
