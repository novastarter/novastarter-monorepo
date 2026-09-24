/**
 * Tests of `memory/kv/types`: the shared helper types of the key-value store, type-only.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { Lock, MaybePromise } from './types.js';
import * as types from './types.js';

test('ships no runtime code', () => {
	// Types only, so nothing here may end up in a consumer's bundle
	expect(Object.keys(types)).toEqual([]);
});

test('MaybePromise wraps or leaves a value alone', () => {
	// A caller `await`s either way, so the wrapper is transparent at the use site
	expectTypeOf<MaybePromise<number>>().toEqualTypeOf<number | Promise<number>>();
});

test('Lock is released once and extended from now', () => {
	// `extend` re-counts the hold from the moment it is called; both methods are asynchronous, on the local store
	// too
	const lock: Lock = {
		release: async () => {},
		extend: async (_duration) => {},
	};

	expectTypeOf(lock.release).returns.toEqualTypeOf<Promise<void>>();
	expect(lock.extend).toBeTypeOf('function');
});
