/**
 * Tests of `redis/utils/get-redis-prefix`.
 */
import { expect, test } from 'vitest';
import { getRedisPrefix } from './get-redis-prefix.js';

test('Returns the plain family for the default location', () => {
	expect(getRedisPrefix('default')).toBe('REDIS');
});

test('Nests a named location under the plain family, upper-cased', () => {
	expect(getRedisPrefix('queue')).toBe('REDIS_QUEUE');
	expect(getRedisPrefix('Sessions')).toBe('REDIS_SESSIONS');
});
