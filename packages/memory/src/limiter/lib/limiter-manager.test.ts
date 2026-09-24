/**
 * Tests of `memory/limiter/lib/limiter-manager`.
 */
import { describe, expect, test, vi } from 'vitest';
import { LimiterDriverLocal } from './drivers/local.js';
import { LimiterManager } from './limiter-manager.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './limiter-manager.js' {
	interface LimiterDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('LimiterManager', () => {
	test('Registers the built-in drivers on construction and builds a location on first use', () => {
		const manager = new LimiterManager();

		// The built-ins are known without any registration by the application
		expect([...manager['drivers'].keys()]).toStrictEqual(['local', 'redis']);

		// Registering a location keeps the configuration only; the first `location()` builds the driver
		manager.registerLocation('default', {
			driver: 'local',
			options: {
				duration: 1,
				points: 1,
			},
		});

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(LimiterDriverLocal);
		expect(manager.location('default')).toBe(manager.location('default'));
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new LimiterManager();
		const mockDriver = vi.fn();

		// A bare mock stands in for a driver class of the application, recording how the manager calls `new
		// Driver(...)`
		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('main', {
			driver: 'test-driver',
			options: {
				namespace: 'n',
			},
		});

		manager.location('main');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ namespace: 'n' });
	});

	test('Refuses a location whose driver is not registered', () => {
		const manager = new LimiterManager();

		// The lookup by name fails at registration, before any instantiation happens
		expect(() =>
			manager.registerLocation('main', {
				driver: 'missing' as 'local',
				options: {
					duration: 1,
					points: 1,
				},
			}),
		).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The "missing" driver isn't registered; call registerDriver() with it before a location uses it.]`,
		);
	});
});
