/**
 * Tests of `memory/kv/driver`: the contract every key-value backend implements, type-only.
 */
import { expect, test } from 'vitest';
import type { KvDriver } from './driver.js';
import * as driver from './driver.js';

test('ships no runtime code', () => {
	// 1. The interface describes the backends; nothing here may end up in a consumer's bundle
	expect(Object.keys(driver)).toEqual([]);
});

test('a backend may answer synchronously or asynchronously', () => {
	// 1. The local store answers plain values while Redis answers promises; the `MaybePromise` return types are
	//    what lets one interface describe both, and `close` is the only optional member
	const local: KvDriver = {
		get: (_key) => undefined,
		set: (_key, _value) => {},
		delete: (_key) => {},
		has: (_key) => true,
		increment: (key, _amount) => (key ? 1 : 0),
		setMax: (_key, _value) => true,
		acquireLock: (_key) => ({
			release: async () => {},
			extend: async (_duration) => {},
		}),
		usingLock: (_key, callback) => callback(),
		clear: () => {},
	};

	expect(local.get).toBeTypeOf('function');
});
