/**
 * Tests of `queue/lib/use-queue`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { QueueManager } from './queue-manager.js';
import { useQueue } from './use-queue.js';

afterEach(() => {
	useQueue.reset();
});

describe('useQueue', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useQueue();

		expect(manager).toBeInstanceOf(QueueManager);
		expect(useQueue()).toBe(manager);

		// `reset()` drops it, so the next test starts from an empty manager
		useQueue.reset();
		expect(useQueue()).not.toBe(manager);
	});
});
