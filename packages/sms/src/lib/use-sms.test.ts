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
		// Registrations made at start-up are visible everywhere because every later call returns the cached instance.
		const first = useSms();
		const second = useSms();

		expect(first).toBeInstanceOf(SmsManager);
		expect(second).toBe(first);

		first.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		expect(second.hasLocation('default')).toBe(true);
	});

	test('Starts over once the cache is reset', () => {
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
