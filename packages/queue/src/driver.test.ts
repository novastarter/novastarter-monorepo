/**
 * Tests of `queue/driver`: the contract every queue driver implements, type-only.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { QueueDriver } from './driver.js';
import * as driver from './driver.js';

test('ships no runtime code', () => {
	// 1. The class is ambient: it types a constructor for `QueueManager.registerDriver`, nothing exists behind it
	//    at runtime
	expect(Object.keys(driver)).toEqual([]);
});

test('describes a constructible contract', () => {
	// 1. `typeof QueueDriver` is what `QueueManager.registerDriver` takes: a constructor over a config record
	expectTypeOf<typeof QueueDriver>().toExtend<new (config: Record<string, unknown>) => QueueDriver>();

	// 2. An implementation satisfies the contract structurally: only `enqueue` is required, `close` and `stats` are
	//    optional
	const minimal: QueueDriver = {
		async enqueue() {
			return { id: '1', name: 'mail.send', queue: 'mail' };
		},
	};

	expect(minimal.enqueue).toBeTypeOf('function');
});
