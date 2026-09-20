/**
 * Tests of `redis/lib/use-redis`.
 *
 * `./create-redis.js` is mocked, so these exercise the per-location memoization alone.
 */
import type { Redis } from 'ioredis';
import { afterEach, expect, test, vi } from 'vitest';
import { createRedis } from './create-redis.js';
import { _cache, useRedis } from './use-redis.js';

vi.mock('./create-redis.js');

afterEach(() => {
	vi.resetAllMocks();

	_cache.redis.clear();
});

test('Returns cached client if exists', () => {
	const cached = {} as Redis;
	_cache.redis.set('default', cached);

	expect(useRedis()).toBe(cached);
	expect(createRedis).not.toHaveBeenCalled();
});

test('Creates new cached client if not exists', () => {
	const mockRedis = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(mockRedis);

	expect(useRedis()).toBe(mockRedis);
	expect(createRedis).toHaveBeenCalledWith('default');
	expect(_cache.redis.get('default')).toBe(mockRedis);
});

test('Builds the client only once across calls', () => {
	vi.mocked(createRedis).mockReturnValue({} as Redis);

	const first = useRedis();
	const second = useRedis();

	expect(first).toBe(second);
	expect(createRedis).toHaveBeenCalledTimes(1);
});

test('Keeps one client per location name', () => {
	const defaultRedis = {} as Redis;
	const queueRedis = {} as Redis;
	vi.mocked(createRedis).mockReturnValueOnce(defaultRedis).mockReturnValueOnce(queueRedis);

	expect(useRedis()).toBe(defaultRedis);
	expect(useRedis('queue')).toBe(queueRedis);
	expect(useRedis('queue')).toBe(queueRedis);

	expect(createRedis).toHaveBeenCalledTimes(2);
	expect(createRedis).toHaveBeenLastCalledWith('queue');
});
