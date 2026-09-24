/**
 * Tests of `types/events`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { ActionHandler, EventContext, FilterHandler, InitHandler } from './events.js';
import * as events from './events.js';

test('ships no runtime code', () => {
	// 1. A types-only module must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(events)).toEqual([]);
});

test('EventContext records the actor and anything the emitter attaches', () => {
	// 1. Only `accountability` is fixed — and may be `null` for an anonymous event; the rest hangs off the index
	//    signature, so a handler reads what the emitting code put there without a cast
	const context: EventContext = {
		accountability: { user: '1' },
		database: {},
	};

	expect(context.accountability).toBeTypeOf('object');
});

test('FilterHandler may replace the payload or leave it as is', () => {
	// 1. Returning `undefined` keeps the payload untouched, so an inspecting handler need not return anything; the
	//    answer may also arrive asynchronously
	expectTypeOf<FilterHandler<string>>().returns.toEqualTypeOf<string | undefined | Promise<string | undefined>>();
});

test('ActionHandler and InitHandler may be synchronous or asynchronous', () => {
	// 1. The emitter waits for no action handler and logs a rejection; the init stage awaits the handler, and both
	//    shapes compile against the same type
	expectTypeOf<ActionHandler>().returns.toEqualTypeOf<void | Promise<void>>();
	expectTypeOf<InitHandler>().returns.toEqualTypeOf<void | Promise<void>>();
	expectTypeOf<InitHandler>().parameters.toEqualTypeOf<[Record<string, unknown>]>();
});
