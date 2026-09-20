import { describe, expect, test, vi } from 'vitest';
import { DriverManager } from './driver-manager.js';

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// 1. A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new DriverManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// 2. Inspect the private map directly, since the public API offers no way to list drivers
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
		expect(mockDriver).not.toHaveBeenCalled();
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new DriverManager();

		expect(() =>
			manager.registerLocation('test-location', { driver: 's3', options: {} }),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Driver "s3" isn't registered.]`);
	});

	test('Instantiates the driver with the options alone', () => {
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);
		manager.registerLocation('test-location', { driver: 'test-driver', options: { foo: 'bar' } });

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
		expect(manager.location('test-location')).toBe(mockDriver.mock.instances[0]);
	});
});

describe('#location', () => {
	test('Throws error when neither the location nor a default one exists', () => {
		const manager = new DriverManager();

		expect(() => manager.location('test-location')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "test-location" doesn't exist.]`,
		);
	});

	test('Falls back to the default location for a name nobody registered', () => {
		const manager = new DriverManager();
		manager.registerDriver('test-driver', vi.fn());
		manager.registerLocation('default', { driver: 'test-driver', options: {} });
		manager.registerLocation('own', { driver: 'test-driver', options: {} });

		expect(manager.location('anything')).toBe(manager.location('default'));
		expect(manager.location('own')).not.toBe(manager.location('default'));
	});
});

describe('#hasLocation / #locationNames', () => {
	test('Reports the registered names only, the default location not standing in', () => {
		const manager = new DriverManager();
		manager.registerDriver('test-driver', vi.fn());
		manager.registerLocation('default', { driver: 'test-driver', options: {} });
		manager.registerLocation('own', { driver: 'test-driver', options: {} });

		expect(manager.hasLocation('own')).toBe(true);
		expect(manager.hasLocation('anything')).toBe(false);
		expect(manager.locationNames()).toEqual(['default', 'own']);
	});
});
