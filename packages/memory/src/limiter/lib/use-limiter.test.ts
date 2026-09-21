/**
 * Tests of `memory/limiter/lib/use-limiter`: one manager per process, resettable, with the built-in drivers
 * registered.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { LimiterDriverLocal } from './drivers/local.js';
import { LimiterManager } from './limiter-manager.js';
import { useLimiter } from './use-limiter.js';

afterEach(() => {
	useLimiter.reset();
});

describe('useLimiter', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useLimiter();

		expect(manager).toBeInstanceOf(LimiterManager);
		expect(useLimiter()).toBe(manager);

		// 2. `reset()` drops it, so the next test starts from a manager with only the built-in drivers
		useLimiter.reset();
		expect(useLimiter()).not.toBe(manager);
	});

	test('The built-in drivers are registered, so a location needs its options alone', () => {
		// 1. `local` comes with the manager; the location is built on first use
		useLimiter().registerLocation('api', {
			driver: 'local',
			options: {
				points: 5,
				duration: 1,
			},
		});

		expect(useLimiter().location('api')).toBeInstanceOf(LimiterDriverLocal);
	});
});
