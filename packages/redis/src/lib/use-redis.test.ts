/**
 * Tests of `redis/lib/use-redis`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { RedisManager } from './redis-manager.js';
import { useRedis } from './use-redis.js';

afterEach(() => {
	// The singleton is rebuilt by the next test, so nothing may carry over
	useRedis.reset();
});

describe('useRedis', () => {
	test('Creates one empty manager and keeps it across calls', () => {
		// The first call builds an empty manager; every later call answers the same instance
		const first = useRedis();

		expect(first).toBeInstanceOf(RedisManager);
		expect(first.locationNames()).toEqual([]);
		expect(useRedis()).toBe(first);
	});

	test('Builds a fresh manager after reset()', () => {
		// A fresh manager knows nothing of the old one: its locations are gone
		const first = useRedis();
		first.registerLocation('default', 'redis://cache:6379');
		useRedis.reset();

		expect(useRedis()).not.toBe(first);
		expect(useRedis().hasLocation('default')).toBe(false);
	});
});
