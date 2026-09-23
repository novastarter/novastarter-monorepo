/**
 * Tests of `redis/lib/create-redis`.
 *
 * `ioredis` is mocked, so these check what reaches the ioredis constructor rather than any real connection.
 */
import { type Logger, registerLogger, useLogger } from '@novastarter/logger';
import { Redis } from 'ioredis';
import { afterEach, expect, test, vi } from 'vitest';
import { createRedis } from './create-redis.js';

vi.mock('ioredis');

afterEach(() => {
	vi.clearAllMocks();

	// 1. A test that registered a process logger must not leak it into the next one
	useLogger.reset();
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

	// 3. `rediss://` turns TLS on, as it does when ioredis reads the string itself — its parser alone leaves it off —
	//    and a URI scheme is case-insensitive, so an upper-cased one gets its TLS too
	createRedis('rediss://cache.internal:6380');

	expect(Redis).toHaveBeenNthCalledWith(3, { tls: true, host: 'cache.internal', port: '6380' });

	createRedis('REDISS://cache.internal:6380');

	expect(Redis).toHaveBeenNthCalledWith(4, { tls: true, host: 'cache.internal', port: '6380' });

	// 4. Every other form ioredis accepts keeps its meaning: an IPv6 literal, a scheme-less host and port, a socket
	//    path and a bare port
	createRedis('redis://[::1]:6379/2');
	createRedis('cache.internal:6380');
	createRedis('/tmp/redis.sock');
	createRedis('6379');

	expect(Redis).toHaveBeenNthCalledWith(5, { host: '::1', port: '6379', db: '2' });
	expect(Redis).toHaveBeenNthCalledWith(6, { host: 'cache.internal', port: '6380' });
	expect(Redis).toHaveBeenNthCalledWith(7, { path: '/tmp/redis.sock' });
	expect(Redis).toHaveBeenNthCalledWith(8, { port: '6379' });
});

test('Lays the overrides over ioredis options', () => {
	createRedis({ host: 'localhost', maxRetriesPerRequest: 20 }, { maxRetriesPerRequest: null });

	expect(Redis).toHaveBeenCalledWith({ host: 'localhost', maxRetriesPerRequest: null });
});

test('Returns the created client', () => {
	const redis = createRedis('redis://localhost:6379');

	expect(redis).toBe(vi.mocked(Redis).mock.instances[0]);
});

test('Reports a client error through the given logger instead of letting it crash the process', () => {
	// 1. A caller's own logger receives the connection errors of the client it created; an `error` event with no
	//    listener throws out of the event emitter, so the listener registered on the client must take it
	const logger = { error: vi.fn() } as unknown as Logger;
	const redis = createRedis('redis://cache.internal:6379', {}, logger);

	// 2. The client registered an `error` listener; invoking it — what ioredis does on every failed reconnect of a
	//    server that is down at boot or drops mid-run — reports the error and throws nowhere
	const listener = vi.mocked(redis.on).mock.calls.find(([event]) => event === 'error')![1] as (error: Error) => void;

	expect(() => listener(new Error('connect ECONNREFUSED 10.0.0.8:6379'))).not.toThrow();
	expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Redis connection error');
});

test('Reports a client error through the process logger when none is given', () => {
	// 1. No logger of its own: the process-wide one takes the line — the path every RedisManager location's client
	//    takes, which is the one an unhandled `error` event would crash
	registerLogger({ error: vi.fn() } as unknown as Logger<never>);

	const redis = createRedis('redis://cache.internal:6379');

	// 2. Emitting the error — ioredis's plain `emit`, the path that throws with no listener — must log and not throw
	const listener = vi.mocked(redis.on).mock.calls.find(([event]) => event === 'error')![1] as (error: Error) => void;

	expect(() => listener(new Error('Command queue state error'))).not.toThrow();
	expect(useLogger().error).toHaveBeenCalledWith(expect.any(Error), 'Redis connection error');
});
