/**
 * Tests of `sms/lib/use-sms`: one manager per process, its registrations shared, resettable.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SmsManager } from './sms-manager.js';
import { useSms } from './use-sms.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	useSms.reset();
});

describe('useSms', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const first = useSms();
		const second = useSms();

		expect(first).toBeInstanceOf(SmsManager);
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
		const manager = useSms();

		manager.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		useSms.reset();

		expect(useSms()).not.toBe(manager);
		expect(useSms().hasLocation('default')).toBe(false);
	});
});
