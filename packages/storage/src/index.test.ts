import { afterEach, describe, expect, test, vi } from 'vitest';
import { _cache, StorageManager, useStorage } from './index.js';

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
				driver: 's3',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Driver "s3" isn't registered.]`);
	});

	test('Instantiates driver instance with passed config', () => {
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

		// 2. The manager must forward `options` alone, not the whole location config
		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
	});

	test('Sets location driver in locations map', () => {
		const mockDriver = vi.fn();

		const manager = new StorageManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		// 1. Inspect the private map directly: the stored value must be an instance, not the class itself
		expect(manager['locations'].size).toBe(1);
		expect(manager['locations'].get('test-location')).toBeInstanceOf(mockDriver);
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

	test('Answers a name with the default location when it has none of its own', () => {
		const mockDriver = vi.fn();
		const storage = useStorage();

		storage.registerDriver('test-driver', mockDriver);
		storage.registerLocation('default', { driver: 'test-driver', options: {} });

		expect(storage.location('anything')).toBe(storage.location('default'));
	});
});
