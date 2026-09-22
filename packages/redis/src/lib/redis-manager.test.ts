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
	// 1. Mocks are rebuilt by the next test's setup, so nothing may carry over
	vi.resetAllMocks();
});

test('Opens the client of a location on first use and hands it out by name from then on', () => {
	// 1. Registering a location opens nothing; the client comes on first use
	const client = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(client);

	const manager = new RedisManager();
	manager.registerLocation('jobs', 'redis://jobs:6379', { maxRetriesPerRequest: null });

	expect(createRedis).not.toHaveBeenCalled();
	expect(manager.hasLocation('jobs')).toBe(true);
	expect(manager.locationNames()).toEqual(['jobs']);

	// 2. The first use opens the client once, with the registered config; every later use hands the same one out
	expect(manager.location('jobs')).toBe(client);
	expect(manager.location('jobs')).toBe(client);
	expect(createRedis).toHaveBeenCalledOnce();
	expect(createRedis).toHaveBeenCalledWith('redis://jobs:6379', { maxRetriesPerRequest: null });
});

test('Answers default without a name and throws for an unknown location', () => {
	// 1. With no default registered, a bare lookup has nothing to answer and an unknown name throws
	const client = {} as Redis;
	vi.mocked(createRedis).mockReturnValue(client);

	const manager = new RedisManager();

	expect(() => manager.location('jobs')).toThrowErrorMatchingInlineSnapshot(`[Error: Location "jobs" doesn't exist.]`);

	// 2. The default location answers a bare `location()`; an unknown name still throws and reports its absence
	manager.registerLocation('default', 'redis://cache:6379');

	expect(manager.location()).toBe(client);
	expect(() => manager.location('jobs')).toThrow(/doesn't exist/);
	expect(manager.hasLocation('jobs')).toBe(false);
});

test('Quits every opened client on close, leaving the registrations in place', async () => {
	// 1. Two locations registered, only the default one used: the close quits exactly the opened clients
	const quit = vi.fn().mockResolvedValue('OK');
	vi.mocked(createRedis).mockImplementation(() => ({ status: 'ready', quit }) as unknown as Redis);

	const manager = new RedisManager();
	manager.registerLocation('default', 'redis://cache:6379');
	manager.registerLocation('jobs', 'redis://jobs:6379');
	manager.location('default');

	await manager.close();

	// 2. Registrations survive the close; only the instantiated clients are gone
	expect(quit).toHaveBeenCalledTimes(1);
	expect(manager.locationNames()).toEqual(['default', 'jobs']);
	expect(manager.instantiated().size).toBe(0);
});

test('Disconnects a client that never reached ready instead of waiting for a quit', async () => {
	// 1. A client that is still connecting, or already ended, has no server to quit: `quit` would reconnect forever
	//    to deliver QUIT and hang the close, so the close must drop the socket without sending anything
	const quit = vi.fn().mockResolvedValue('OK');
	const disconnect = vi.fn();

	vi.mocked(createRedis).mockImplementation(() => ({ status: 'connecting', quit, disconnect }) as unknown as Redis);

	const manager = new RedisManager();
	manager.registerLocation('default', 'redis://cache:6379');
	manager.location('default');

	await manager.close();

	expect(disconnect).toHaveBeenCalledOnce();
	expect(quit).not.toHaveBeenCalled();
});
