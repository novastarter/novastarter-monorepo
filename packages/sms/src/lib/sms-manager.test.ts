/**
 * Tests of `sms/lib/sms-manager` on managers built by hand; the process-wide one is `use-sms.test.ts`'s.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SmsDriverConsole } from './drivers/console.js';
import { SmsManager } from './sms-manager.js';

vi.mock('@novastarter/logger');

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './sms-manager.js' {
	interface SmsDrivers {
		'test-driver': Record<string, unknown>;
	}
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ info: vi.fn() } as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('SmsManager', () => {
	test('Registers the built-in driver on construction and builds a location on first use', () => {
		const manager = new SmsManager();

		// 1. The console driver is known without any registration by the application
		expect([...manager['drivers'].keys()]).toStrictEqual(['console']);

		// 2. Registering a location keeps the configuration only; the first `location()` builds the driver
		manager.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(SmsDriverConsole);
		expect(manager.location('default')).toBe(manager.location('default'));
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new SmsManager();
		const mockDriver = vi.fn();

		// 1. A bare mock stands in for a vendor driver class, recording how the manager calls `new Driver(...)`
		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('main', {
			driver: 'test-driver',
			options: {
				apiKey: 'k',
			},
		});

		manager.location('main');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ apiKey: 'k' });
	});

	test('Holds the routes the application registers, replacing them on a second call', () => {
		const manager = new SmsManager();

		// 1. Nothing registered yet: an empty object, so callers can read `routes().from` without a guard
		expect(manager.routes()).toStrictEqual({});

		// 2. The last registration wins whole, the way `registerLocation` replaces a location
		manager.registerRoutes({ from: '+14155550100', transactional: ['main'] });
		manager.registerRoutes({ from: 'Acme' });

		expect(manager.routes()).toStrictEqual({ from: 'Acme' });
	});
});
