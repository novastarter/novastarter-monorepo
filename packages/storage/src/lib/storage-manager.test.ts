/**
 * Tests of `storage/lib/storage-manager`.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { describe, expect, test, vi } from 'vitest';
import { StorageManager } from './storage-manager.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './storage-manager.js' {
	interface StorageDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new StorageManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// The public API offers no way to list registrations, so the private map is read directly
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new StorageManager();

		// No driver was registered, so the lookup by name must fail before any instantiation happens
		expect(() =>
			manager.registerLocation('test-driver', {
				driver: 'test-driver',
				options: {},
			}),
		).toThrowError(InvalidConfigError);
	});

	test('Instantiates the driver with the passed options on first use', () => {
		// `vi.fn()` is constructible, so it records how the manager calls `new Driver(...)`
		const mockDriver = vi.fn();

		const manager = new StorageManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		// Registration keeps the configuration only; the first use builds the driver from `options` alone
		expect(mockDriver).not.toHaveBeenCalled();

		manager.location('test-location');

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
		expect(manager.instantiated().get('test-location')).toBeInstanceOf(mockDriver);
	});
});

describe('#location', () => {
	test(`Throws error if location is used that wasn't registered`, () => {
		const manager = new StorageManager();

		// An unknown name must throw rather than return `undefined`, since callers chain storage calls on the result
		expect(() => manager.location('missing')).toThrowError(InvalidConfigError);
		expect(() => manager.location('missing')).toThrowError('"missing"');
	});

	test('Returns driver instance of registered location', () => {
		const mockDriver = vi.fn();

		const manager = new StorageManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		const driverInstance = manager.location('test-location');

		expect(driverInstance).toBeInstanceOf(mockDriver);
	});
});
