/**
 * Tests of `memory/lib/use-memory` and the four managers.
 */
import { afterEach, expect, test } from 'vitest';
import { BusDriverLocal } from '../bus/lib/local.js';
import { CacheDriverLocal } from '../cache/lib/local.js';
import { KvDriverLocal } from '../kv/lib/local.js';
import { LimiterDriverLocal } from '../limiter/lib/local.js';
import { useBus, useCache, useKv, useLimiter } from './use-memory.js';

afterEach(() => {
	useKv.reset();
	useCache.reset();
	useBus.reset();
	useLimiter.reset();
});

test('Each accessor keeps one manager per process', () => {
	expect(useKv()).toBe(useKv());
	expect(useCache()).toBe(useCache());
	expect(useBus()).toBe(useBus());
	expect(useLimiter()).toBe(useLimiter());
});

test('The built-in drivers are registered, so a location needs its options alone', async () => {
	useKv().registerLocation('default', {
		driver: 'local',
		options: {},
	});

	useCache().registerLocation('default', {
		driver: 'local',
		options: {
			maxKeys: 10,
		},
	});

	useBus().registerLocation('default', {
		driver: 'local',
		options: {},
	});

	useLimiter().registerLocation('api', {
		driver: 'local',
		options: {
			points: 5,
			duration: 1,
		},
	});

	expect(useKv().location('default')).toBeInstanceOf(KvDriverLocal);
	expect(useCache().location('default')).toBeInstanceOf(CacheDriverLocal);
	expect(useBus().location('default')).toBeInstanceOf(BusDriverLocal);
	expect(useLimiter().location('api')).toBeInstanceOf(LimiterDriverLocal);

	await useKv().location('default').set('key', 'value');
	expect(await useKv().location('default').get('key')).toBe('value');
});

test('A location of an unknown driver is refused, an unknown location too', () => {
	expect(() =>
		useKv().registerLocation('x', {
			driver: 'memcached' as 'local',
			options: {},
		}),
	).toThrow(/isn't registered/);

	expect(() => useKv().location('nope')).toThrow(/doesn't exist/);
});
