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

test('Opens the client of a location on first use and hands it out by name from then on', () => {
	const client = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(client);

	const manager = new RedisManager();
	manager.registerLocation('jobs', 'redis://jobs:6379', { maxRetriesPerRequest: null });

	expect(createRedis).not.toHaveBeenCalled();
	expect(manager.hasLocation('jobs')).toBe(true);
	expect(manager.locationNames()).toEqual(['jobs']);

	expect(manager.location('jobs')).toBe(client);
	expect(manager.location('jobs')).toBe(client);
	expect(createRedis).toHaveBeenCalledOnce();
	expect(createRedis).toHaveBeenCalledWith('redis://jobs:6379', { maxRetriesPerRequest: null });
});

test('Answers default without a name and throws for an unknown location', () => {
	const client = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(client);

	const manager = new RedisManager();

	expect(() => manager.location('jobs')).toThrowErrorMatchingInlineSnapshot(`[Error: Location "jobs" doesn't exist.]`);

	manager.registerLocation('default', 'redis://cache:6379');

	expect(manager.location()).toBe(client);
	expect(() => manager.location('jobs')).toThrow(/doesn't exist/);
	expect(manager.hasLocation('jobs')).toBe(false);
});

test('Quits every opened client on close, leaving the registrations in place', async () => {
	const quit = vi.fn().mockResolvedValue('OK');
	vi.mocked(createRedis).mockImplementation(() => ({ quit }) as unknown as Redis);

	const manager = new RedisManager();
	manager.registerLocation('default', 'redis://cache:6379');
	manager.registerLocation('jobs', 'redis://jobs:6379');
	manager.location('default');

	await manager.close();

	expect(quit).toHaveBeenCalledTimes(1);
	expect(manager.locationNames()).toEqual(['default', 'jobs']);
});
