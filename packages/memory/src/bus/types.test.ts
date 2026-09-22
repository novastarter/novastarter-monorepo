/**
 * Tests of `memory/bus/types`: the callback shape of the bus, type-only.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { MessageHandler } from './types.js';
import * as types from './types.js';

test('ships no runtime code', () => {
	// 1. Types only: nothing here may end up in a consumer's bundle
	expect(Object.keys(types)).toEqual([]);
});

test('MessageHandler takes the payload and may be async', () => {
	// 1. The bus waits for no handler, so a synchronous callback is as good as an asynchronous one — the return
	//    type admits both
	expectTypeOf<MessageHandler<number>>().toEqualTypeOf<(payload: number) => void | Promise<void>>();
});
