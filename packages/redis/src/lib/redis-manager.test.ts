/**
 * Tests of `redis/lib/redis-manager`.
 *
 * `./create-redis.js` is mocked, so these exercise the registry alone.
 */
import type { Redis } from 'ioredis';
import { afterEach, expect, test, vi } from 'vitest';
import { createRedis } from './create-redis.js';
import { RedisManager } from './redis-manager.js';

vi.mock('./create-redis.js');

afterEach(() => {
	vi.resetAllMocks();
});

test('Opens the client of a location on registration and hands it out by name', () => {
	const client = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(client);

	const manager = new RedisManager();
	manager.registerLocation('jobs', 'redis://jobs:6379', { maxRetriesPerRequest: null });

	expect(createRedis).toHaveBeenCalledWith('redis://jobs:6379', { maxRetriesPerRequest: null });
	expect(manager.location('jobs')).toBe(client);
	expect(manager.hasLocation('jobs')).toBe(true);
	expect(manager.locationNames()).toEqual(['jobs']);
});

test('Falls back to the default location, and throws without one', () => {
	const fallback = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(fallback);

	const manager = new RedisManager();

	expect(() => manager.location('jobs')).toThrowErrorMatchingInlineSnapshot(`[Error: Location "jobs" doesn't exist.]`);

	manager.registerLocation('default', 'redis://cache:6379');

	expect(manager.location('jobs')).toBe(fallback);
	expect(manager.location()).toBe(fallback);
	expect(manager.hasLocation('jobs')).toBe(false);
});

test('Quits every client on close', async () => {
	const quit = vi.fn().mockResolvedValue('OK');
	vi.mocked(createRedis).mockImplementation(() => ({ quit }) as unknown as Redis);

	const manager = new RedisManager();
	manager.registerLocation('default', 'redis://cache:6379');
	manager.registerLocation('jobs', 'redis://jobs:6379');

	await manager.close();

	expect(quit).toHaveBeenCalledTimes(2);
	expect(manager.locationNames()).toEqual([]);
});
