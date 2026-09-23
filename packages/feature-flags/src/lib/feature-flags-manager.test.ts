/**
 * Tests of `feature-flags/lib/feature-flags-manager`.
 */
import { describe, expect, test, vi } from 'vitest';
import { FeatureFlagsDriverStatic } from './drivers/static.js';
import { FeatureFlagsManager } from './feature-flags-manager.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './feature-flags-manager.js' {
	interface FeatureFlagsDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('FeatureFlagsManager', () => {
	test('Registers the built-in driver on construction and builds a location on first use', async () => {
		const manager = new FeatureFlagsManager();

		// 1. The built-in is known without any registration by the application
		expect([...manager['drivers'].keys()]).toStrictEqual(['static']);

		// 2. Registering a location keeps the configuration only; the first `location()` builds the driver
		manager.registerLocation('default', {
			driver: 'static',
			options: {
				flags: [{ key: 'new-billing', enabled: true }],
			},
		});

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(FeatureFlagsDriverStatic);
		expect(manager.location('default')).toBe(manager.location('default'));
		await expect(manager.location('default').get('new-billing', {})).resolves.toBe(true);
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new FeatureFlagsManager();
		const mockDriver = vi.fn();

		// 1. A bare mock stands in for a driver class of the application, recording how the manager calls `new Driver(...)`
		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('vendor', {
			driver: 'test-driver',
			options: {
				apiKey: 'key',
			},
		});

		manager.location('vendor');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ apiKey: 'key' });
	});
});
