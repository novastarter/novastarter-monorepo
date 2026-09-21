/**
 * Tests of `redis/lib/use-redis`: one manager per process, resettable.
 */
import { afterEach, expect, test } from 'vitest';
import { RedisManager } from './redis-manager.js';
import { useRedis } from './use-redis.js';

afterEach(() => {
	useRedis.reset();
});

test('Creates one empty manager and keeps it across calls', () => {
	const first = useRedis();

	expect(first).toBeInstanceOf(RedisManager);
	expect(first.locationNames()).toEqual([]);
	expect(useRedis()).toBe(first);
});

test('Builds a fresh manager after reset()', () => {
	const first = useRedis();
	first.registerLocation('default', 'redis://cache:6379');
	useRedis.reset();

	expect(useRedis()).not.toBe(first);
	expect(useRedis().hasLocation('default')).toBe(false);
});
