/**
 * Tests of `redis/utils/redis-config-available`.
 *
 * `@novastarter/env` is mocked, so each case hands in the exact environment under test.
 */
import { useEnv } from '@novastarter/env';
import { afterEach, expect, test, vi } from 'vitest';
import { redisConfigAvailable } from './redis-config-available.js';

vi.mock('@novastarter/env');

afterEach(() => {
	vi.resetAllMocks();
});

test('Returns false when nothing Redis related is set', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(redisConfigAvailable()).toBe(false);
});

test('Returns true for a connection URL', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS: 'redis://localhost:6379' });

	expect(redisConfigAvailable()).toBe(true);
});

test('Returns true for a split variable', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_HOST: 'localhost' });

	expect(redisConfigAvailable()).toBe(true);
});

test('REDIS_ENABLED=false wins over connection variables', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_ENABLED: false, REDIS: 'redis://localhost:6379', REDIS_HOST: 'localhost' });

	expect(redisConfigAvailable()).toBe(false);
});

test('REDIS_ENABLED=true counts as configured without connection variables', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_ENABLED: true });

	expect(redisConfigAvailable()).toBe(true);
});

test('Namespace variables and the location list alone do not count', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: 'queue', REDIS_BUS_NAMESPACE: 'bus' });

	expect(redisConfigAvailable()).toBe(false);
});

test('Variables of a named location do not count for the default one', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: 'queue', REDIS_QUEUE_HOST: 'queue' });

	expect(redisConfigAvailable()).toBe(false);
	expect(redisConfigAvailable('queue')).toBe(true);
});

test('A named location has its own URL and switch', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: 'queue', REDIS_QUEUE: 'redis://queue:6379' });
	expect(redisConfigAvailable('queue')).toBe(true);

	vi.mocked(useEnv).mockReturnValue({
		REDIS_LOCATIONS: 'queue',
		REDIS_QUEUE: 'redis://queue:6379',
		REDIS_QUEUE_ENABLED: false,
	});

	expect(redisConfigAvailable('queue')).toBe(false);
});
