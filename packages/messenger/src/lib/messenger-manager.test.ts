/**
 * Tests of `messenger/lib/messenger-manager`.
 */
import { describe, expect, test, vi } from 'vitest';
import { MessengerDriverConsole } from './drivers/console.js';
import { MessengerManager } from './messenger-manager.js';

vi.mock('@novastarter/logger');

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './messenger-manager.js' {
	interface MessengerDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('MessengerManager', () => {
	test('Registers the built-in driver on construction and builds a location on first use', () => {
		const manager = new MessengerManager();

		// 1. The built-in is known without any registration by the application
		expect([...manager['drivers'].keys()]).toStrictEqual(['console']);

		// 2. Registering a location keeps the configuration only; the first `location()` builds the driver
		manager.registerLocation('default', { driver: 'console', options: {} });

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(MessengerDriverConsole);
		expect(manager.location('default')).toBe(manager.location('default'));
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new MessengerManager();
		const mockDriver = vi.fn();

		// 1. A bare mock stands in for a messenger's driver, recording how the manager calls `new Driver(...)`
		manager.registerDriver('test-driver', mockDriver);
		manager.registerLocation('telegram', { driver: 'test-driver', options: { token: 't' } });
		manager.location('telegram');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ token: 't' });
	});
});
