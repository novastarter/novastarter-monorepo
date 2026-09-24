/**
 * Tests of `memory/cache/lib/use-cache`: one manager per process, resettable, with the built-in drivers registered.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { CacheManager } from './cache-manager.js';
import { CacheDriverLocal } from './drivers/local.js';
import { useCache } from './use-cache.js';

afterEach(() => {
	useCache.reset();
});

describe('useCache', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useCache();

		expect(manager).toBeInstanceOf(CacheManager);
		expect(useCache()).toBe(manager);

		// `reset()` drops it, so the next test starts from a manager with only the built-in drivers
		useCache.reset();
		expect(useCache()).not.toBe(manager);
	});

	test('The built-in drivers are registered, so a location needs its options alone', () => {
		// `local` comes with the manager; the location is built on first use
		useCache().registerLocation('default', {
			driver: 'local',
			options: {
				maxKeys: 10,
			},
		});

		expect(useCache().location('default')).toBeInstanceOf(CacheDriverLocal);
	});
});
