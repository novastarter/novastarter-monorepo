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

	test('Keeps the configuration without instantiating the driver', () => {
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);
		manager.registerLocation('test-location', { driver: 'test-driver', options: { foo: 'bar' } });

		expect(mockDriver).not.toHaveBeenCalled();
		expect(manager.hasLocation('test-location')).toBe(true);
		expect(manager.locationNames()).toEqual(['test-location']);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Drops the instance of a location registered again', () => {
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);
		manager.registerLocation('test-location', { driver: 'test-driver', options: { foo: 'bar' } });
		const first = manager.location('test-location');

		manager.registerLocation('test-location', { driver: 'test-driver', options: { foo: 'baz' } });

		expect(manager.location('test-location')).not.toBe(first);
		expect(mockDriver).toHaveBeenLastCalledWith({ foo: 'baz' });
	});
});

describe('#location', () => {
	test('Throws error when the location does not exist', () => {
		const manager = new DriverManager();

		expect(() => manager.location('test-location')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "test-location" doesn't exist.]`,
		);
	});

	test('Instantiates the driver with the options alone on first use, then reuses it', () => {
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);
		manager.registerLocation('test-location', { driver: 'test-driver', options: { foo: 'bar' } });

		const first = manager.location('test-location');

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
		expect(first).toBe(mockDriver.mock.instances[0]);
		expect(manager.location('test-location')).toBe(first);
		expect(mockDriver).toHaveBeenCalledOnce();
		expect([...manager.instantiated().keys()]).toEqual(['test-location']);
	});
});
