/**
 * Tests of `payments/lib/payments-manager`: the manager is the kit's `DriverManager`, so only what a payments
 * location adds on top is checked here — registration, lazy instantiation, the default location name.
 */
import { DEFAULT_LOCATION } from '@novastarter/utils';
import { describe, expect, test, vi } from 'vitest';
import { PaymentsManager } from './payments-manager.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './payments-manager.js' {
	interface PaymentsDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// Registration only stores the class and never instantiates it, so a bare mock is enough.
		const manager = new PaymentsManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// The public API offers no way to list registrations, so the private map is read directly.
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new PaymentsManager();

		expect(() =>
			manager.registerLocation(DEFAULT_LOCATION, {
				driver: 'test-driver',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The "test-driver" driver isn't registered; call registerDriver() with it before a location uses it.]`,
		);
	});

	test('Instantiates the driver with the passed options on first use', () => {
		// `vi.fn()` is constructible, so it records how the manager calls `new Driver(...)`.
		const mockDriver = vi.fn();

		const manager = new PaymentsManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation(DEFAULT_LOCATION, {
			driver: 'test-driver',
			options: {
				apiKey: 'key',
			},
		});

		// Registration keeps the configuration only; the first use builds the driver from `options` alone.
		expect(mockDriver).not.toHaveBeenCalled();

		manager.location(DEFAULT_LOCATION);

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ apiKey: 'key' });
		expect(manager.instantiated().get(DEFAULT_LOCATION)).toBeInstanceOf(mockDriver);
	});
});

describe('#location', () => {
	test('Throws error when a location is not registered', () => {
		const manager = new PaymentsManager();

		// A missing location is a configuration mistake the reader has to find, so the message names it.
		expect(() => manager.location('nope')).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Location "nope" doesn't exist; register it with registerLocation() before using it.]`,
		);
	});
});
