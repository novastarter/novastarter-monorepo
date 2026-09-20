/**
 * Tests of `redis/lib/create-redis`.
 *
 * `@novastarter/env` and `ioredis` are mocked, so these check what reaches the ioredis constructor for a given
 * environment rather than any real connection. The location helpers run for real, driven by the mocked env.
 */
import { getConfigFromEnv, useEnv } from '@novastarter/env';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NON_CLIENT_KEYS } from '../constants/locations.js';
import { createRedis } from './create-redis.js';

vi.mock('@novastarter/env');
vi.mock('ioredis');

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({});
	vi.mocked(getConfigFromEnv).mockReturnValue({});
});

afterEach(() => {
	vi.clearAllMocks();
});

test('Uses the REDIS connection URL when set', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS: 'redis://localhost:6379', REDIS_HOST: 'ignored' });

	createRedis();

	expect(Redis).toHaveBeenCalledWith('redis://localhost:6379');
	expect(getConfigFromEnv).not.toHaveBeenCalled();
});

test('Builds the options from the REDIS_* variables otherwise', () => {
	const options = { host: 'localhost', port: 6379 };
	vi.mocked(getConfigFromEnv).mockReturnValue(options);

	createRedis();

	expect(getConfigFromEnv).toHaveBeenCalledWith('REDIS_', {
		omitKey: [...NON_CLIENT_KEYS, 'REDIS_ENABLED'],
		omitPrefix: [],
	});

	expect(Redis).toHaveBeenCalledWith(options);
});

test('Skips the families of the named locations for the default client', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: ['queue', 'sessions'], REDIS_HOST: 'localhost' });

	createRedis();

	expect(getConfigFromEnv).toHaveBeenCalledWith('REDIS_', {
		omitKey: [...NON_CLIENT_KEYS, 'REDIS_ENABLED'],
		omitPrefix: ['REDIS_QUEUE_', 'REDIS_SESSIONS_'],
	});
});

test('Uses the URL of a named location when set', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: 'queue', REDIS_QUEUE: 'redis://queue:6379' });

	createRedis('queue');

	expect(Redis).toHaveBeenCalledWith('redis://queue:6379');
	expect(getConfigFromEnv).not.toHaveBeenCalled();
});

test('Builds a named location from its own family, skipping the other named ones', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: ['queue', 'sessions'], REDIS_QUEUE_HOST: 'queue' });

	createRedis('queue');

	expect(getConfigFromEnv).toHaveBeenCalledWith('REDIS_QUEUE_', {
		omitKey: [...NON_CLIENT_KEYS, 'REDIS_QUEUE_ENABLED'],
		omitPrefix: ['REDIS_SESSIONS_'],
	});
});

test('Returns the created client', () => {
	const redis = createRedis();

	expect(redis).toBe(vi.mocked(Redis).mock.instances[0]);
});
