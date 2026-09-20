/**
 * Tests of `queue/lib/use-queue`: one manager per process, resettable through `_cache`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { QueueManager } from './queue-manager.js';
import { _cache, useQueue } from './use-queue.js';

afterEach(() => {
	_cache.queue = undefined;
});

describe('useQueue', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Nothing is built until asked, so a process without jobs never constructs a manager
		expect(_cache.queue).toBeUndefined();

		const manager = useQueue();

		expect(manager).toBeInstanceOf(QueueManager);
		expect(_cache.queue).toBe(manager);

		// 2. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		expect(useQueue()).toBe(manager);
	});
});
