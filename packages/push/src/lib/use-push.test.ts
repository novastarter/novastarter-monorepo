/**
 * Tests of `push/lib/use-push`: one manager per process, its registrations shared, resettable.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PushManager } from './push-manager.js';
import { usePush } from './use-push.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	usePush.reset();
});

describe('usePush', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const first = usePush();
		const second = usePush();

		expect(first).toBeInstanceOf(PushManager);
		expect(second).toBe(first);

		// 2. A location registered through one handle is visible through the other
		first.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		expect(second.hasLocation('default')).toBe(true);
	});

	test('Starts over once the cache is reset', () => {
		// 1. Tests reset the cache in place; the next call builds a fresh manager without the old locations
		const manager = usePush();

		manager.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		usePush.reset();

		expect(usePush()).not.toBe(manager);
		expect(usePush().hasLocation('default')).toBe(false);
	});
});
