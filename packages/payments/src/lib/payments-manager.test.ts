/**
 * Tests of `payments/lib/payments-manager`: the manager is the kit's `DriverManager`, so only what a payments
 * location adds on top is checked here — registration, lazy instantiation, the default location name.
 */
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_PAYMENTS_LOCATION, PaymentsManager } from './payments-manager.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './payments-manager.js' {
	interface PaymentsDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// 1. A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new PaymentsManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// 2. Inspect the private map directly, since the public API offers no way to list registrations
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new PaymentsManager();

		// 1. No driver was registered, so the lookup by name must fail before any instantiation happens
		expect(() =>
			manager.registerLocation(DEFAULT_PAYMENTS_LOCATION, {
				driver: 'test-driver',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Driver "test-driver" isn't registered.]`);
	});

	test('Instantiates the driver with the passed options on first use', () => {
		// 1. `vi.fn()` is constructible, so it records how the manager calls `new Driver(...)`
		const mockDriver = vi.fn();

		const manager = new PaymentsManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation(DEFAULT_PAYMENTS_LOCATION, {
			driver: 'test-driver',
			options: {
				apiKey: 'key',
			},
		});

		// 2. Registration keeps the configuration only; the first use builds the driver from `options` alone
		expect(mockDriver).not.toHaveBeenCalled();

		manager.location(DEFAULT_PAYMENTS_LOCATION);

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ apiKey: 'key' });
		expect(manager.instantiated().get(DEFAULT_PAYMENTS_LOCATION)).toBeInstanceOf(mockDriver);
	});
});

describe('#location', () => {
	test('Throws error when a location is not registered', () => {
		const manager = new PaymentsManager();

		// 1. The message names the location, since a missing one is a configuration mistake the reader has to find
		expect(() => manager.location('nope')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "nope" doesn't exist.]`,
		);
	});
});
