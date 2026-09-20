/**
 * Tests of `redis/lib/create-redis`.
 *
 * `ioredis` is mocked, so these check what reaches the ioredis constructor rather than any real connection.
 */
import { Redis } from 'ioredis';
import { afterEach, expect, test, vi } from 'vitest';
import { createRedis } from './create-redis.js';

vi.mock('ioredis');

afterEach(() => {
	vi.clearAllMocks();
});

test('Passes a connection URL through, the overrides next to it', () => {
	createRedis('redis://localhost:6379');
	createRedis('redis://localhost:6379', { maxRetriesPerRequest: null });

	expect(Redis).toHaveBeenNthCalledWith(1, 'redis://localhost:6379', {});
	expect(Redis).toHaveBeenNthCalledWith(2, 'redis://localhost:6379', { maxRetriesPerRequest: null });
});

test('Lays the overrides over ioredis options', () => {
	createRedis({ host: 'localhost', maxRetriesPerRequest: 20 }, { maxRetriesPerRequest: null });

	expect(Redis).toHaveBeenCalledWith({ host: 'localhost', maxRetriesPerRequest: null });
});

test('Returns the created client', () => {
	const redis = createRedis('redis://localhost:6379');

	expect(redis).toBe(vi.mocked(Redis).mock.instances[0]);
});
