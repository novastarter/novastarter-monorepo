import { afterEach, describe, expect, test, vi } from 'vitest';
import { _cache, StorageManager, useStorage } from './index.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './index.js' {
	interface StorageDrivers {
		'test-driver': Record<string, unknown>;
	}
}

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// 1. A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new StorageManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// 2. Inspect the private map directly, since the public API offers no way to list registrations
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new StorageManager();

		// 1. No driver was registered, so the lookup by name must fail before any instantiation happens
		expect(() =>
			manager.registerLocation('test-driver', {
				driver: 'test-driver',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Driver "test-driver" isn't registered.]`);
	});

	test('Instantiates the driver with the passed options on first use', () => {
		// 1. `vi.fn()` is constructible, so it records how the manager calls `new Driver(...)`
		const mockDriver = vi.fn();

		const manager = new StorageManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		// 2. Registration keeps the configuration only; the first use builds the driver from `options` alone
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

		// 1. An unknown name must throw rather than return `undefined`, since callers chain storage calls on the result
		expect(() => manager.location('missing')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "missing" doesn't exist.]`,
		);
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

		// 1. The public getter must hand back the same instance that registration created
		const driverInstance = manager.location('test-location');

		expect(driverInstance).toBeInstanceOf(mockDriver);
	});
});

describe('useStorage', () => {
	afterEach(() => {
		_cache.storage = undefined;
	});

	test('Returns the same empty manager on every call', () => {
		const first = useStorage();

		expect(first).toBeInstanceOf(StorageManager);
		expect(useStorage()).toBe(first);
	});

	test('Shares the registrations with every later caller', () => {
		const mockDriver = vi.fn();

		useStorage().registerDriver('test-driver', mockDriver);
		useStorage().registerLocation('uploads', { driver: 'test-driver', options: {} });

		expect(useStorage().location('uploads')).toBe(useStorage().location('uploads'));
	});
});
