/**
 * Tests of `redis/types`: the configuration shape, type-only.
 */
import type { RedisOptions } from 'ioredis';
import { expect, expectTypeOf, test } from 'vitest';
import type { RedisConfig } from './types.js';
import * as types from './types.js';

test('ships no runtime code', () => {
	// Types only: nothing here may end up in a consumer's bundle
	expect(Object.keys(types)).toEqual([]);
});

test('RedisConfig is a connection URL or ioredis options', () => {
	// The application's configuration carries a URL; anything ioredis accepts as options is the other shape, and
	// both mean the same to `createRedis()`
	expectTypeOf<RedisConfig>().toEqualTypeOf<string | RedisOptions>();

	const url: RedisConfig = 'redis://user:pass@localhost:6379/0';
	const options: RedisConfig = { host: 'localhost', port: 6379 };

	expect(url).toBeTypeOf('string');
	expect(options).toBeTypeOf('object');
});
