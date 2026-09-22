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

test("Takes a connection URL apart with ioredis's own parser and lays the overrides over what it carries", () => {
	// 1. Host, port, credentials, database and query parameters, exactly as ioredis reads them (ports and the
	//    database stay strings, as its parser leaves them)
	createRedis('redis://user:p%40ss@cache.internal:6380/2?family=6&maxRetriesPerRequest=20');

	expect(Redis).toHaveBeenNthCalledWith(1, {
		host: 'cache.internal',
		port: '6380',
		username: 'user',
		password: 'p@ss',
		db: '2',
		family: 6,
		maxRetriesPerRequest: '20',
	});

	// 2. An override wins over the URL's query, where ioredis itself would keep the URL's value
	createRedis('redis://localhost:6379?maxRetriesPerRequest=20', { maxRetriesPerRequest: null });

	expect(Redis).toHaveBeenNthCalledWith(2, { host: 'localhost', port: '6379', maxRetriesPerRequest: null });

	// 3. `rediss://` turns TLS on, as it does when ioredis reads the string itself — its parser alone leaves it off
	createRedis('rediss://cache.internal:6380');

	expect(Redis).toHaveBeenNthCalledWith(3, { tls: true, host: 'cache.internal', port: '6380' });

	// 4. Every other form ioredis accepts keeps its meaning: an IPv6 literal, a scheme-less host and port, a socket
	//    path and a bare port
	createRedis('redis://[::1]:6379/2');
	createRedis('cache.internal:6380');
	createRedis('/tmp/redis.sock');
	createRedis('6379');

	expect(Redis).toHaveBeenNthCalledWith(4, { host: '::1', port: '6379', db: '2' });
	expect(Redis).toHaveBeenNthCalledWith(5, { host: 'cache.internal', port: '6380' });
	expect(Redis).toHaveBeenNthCalledWith(6, { path: '/tmp/redis.sock' });
	expect(Redis).toHaveBeenNthCalledWith(7, { port: '6379' });
});

test('Lays the overrides over ioredis options', () => {
	createRedis({ host: 'localhost', maxRetriesPerRequest: 20 }, { maxRetriesPerRequest: null });

	expect(Redis).toHaveBeenCalledWith({ host: 'localhost', maxRetriesPerRequest: null });
});

test('Returns the created client', () => {
	const redis = createRedis('redis://localhost:6379');

	expect(redis).toBe(vi.mocked(Redis).mock.instances[0]);
});
