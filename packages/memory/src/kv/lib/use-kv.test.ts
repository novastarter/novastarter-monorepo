/**
 * Tests of `memory/kv/lib/use-kv`: one manager per process, resettable, with the built-in drivers registered.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { KvDriverLocal } from './drivers/local.js';
import { KvManager } from './kv-manager.js';
import { useKv } from './use-kv.js';

afterEach(() => {
	useKv.reset();
});

describe('useKv', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useKv();

		expect(manager).toBeInstanceOf(KvManager);
		expect(useKv()).toBe(manager);

		// `reset()` drops it, so the next test starts from a manager with only the built-in drivers
		useKv.reset();
		expect(useKv()).not.toBe(manager);
	});

	test('The built-in drivers are registered, so a location needs its options alone', async () => {
		useKv().registerLocation('default', {
			driver: 'local',
			options: {},
		});

		expect(useKv().location('default')).toBeInstanceOf(KvDriverLocal);

		await useKv().location('default').set('key', 'value');
		expect(await useKv().location('default').get('key')).toBe('value');
	});

	test('A location of an unknown driver is refused, an unknown location too', () => {
		// Both are configuration bugs and fail loudly at registration or first use
		expect(() =>
			useKv().registerLocation('x', {
				driver: 'memcached' as 'local',
				options: {},
			}),
		).toThrow(/isn't registered/);

		expect(() => useKv().location('nope')).toThrow(/doesn't exist/);
	});
});
