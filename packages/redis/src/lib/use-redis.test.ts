/**
 * Tests of `redis/lib/use-redis`.
 */
import { afterEach, expect, test } from 'vitest';
import { RedisManager } from './redis-manager.js';
import { _cache, useRedis } from './use-redis.js';

afterEach(() => {
	_cache.redis = undefined;
});

test('Returns the cached manager if it exists', () => {
	const cached = new RedisManager();
	_cache.redis = cached;

	expect(useRedis()).toBe(cached);
});

test('Creates one empty manager and keeps it across calls', () => {
	const first = useRedis();

	expect(first).toBeInstanceOf(RedisManager);
	expect(first.locationNames()).toEqual([]);
	expect(useRedis()).toBe(first);
});
