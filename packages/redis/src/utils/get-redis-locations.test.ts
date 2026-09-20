/**
 * Tests of `redis/utils/get-redis-locations`.
 *
 * `@novastarter/env` is mocked, so each case hands in the exact `REDIS_LOCATIONS` value under test; `toArray` runs for
 * real because the string-versus-array handling is the point.
 */
import { useEnv } from '@novastarter/env';
import { afterEach, expect, test, vi } from 'vitest';
import { getRedisLocations } from './get-redis-locations.js';

vi.mock('@novastarter/env');

afterEach(() => {
	vi.resetAllMocks();
});

test('Returns an empty list when REDIS_LOCATIONS is unset or empty', () => {
	vi.mocked(useEnv).mockReturnValue({});
	expect(getRedisLocations()).toStrictEqual([]);

	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: '' });
	expect(getRedisLocations()).toStrictEqual([]);
});

test('Accepts a single name as a plain string', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: 'queue' });

	expect(getRedisLocations()).toStrictEqual(['queue']);
});

test('Accepts a list, trims the names and drops duplicates', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: ['queue', ' sessions ', 'queue', ''] });

	expect(getRedisLocations()).toStrictEqual(['queue', 'sessions']);
});

test('Leaves the default location out even when it is listed', () => {
	vi.mocked(useEnv).mockReturnValue({ REDIS_LOCATIONS: ['default', 'queue'] });

	expect(getRedisLocations()).toStrictEqual(['queue']);
});
