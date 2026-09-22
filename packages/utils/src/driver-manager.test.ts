/**
 * Tests of `utils/driver-manager`.
 */
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
		// 1. The driver name is checked at registration, so a typo in a location config fails at startup, not on first use
		const manager = new DriverManager();

		expect(() =>
			manager.registerLocation('test-location', {
				driver: 's3',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: Driver "s3" isn't registered.]`);
	});

	test('Keeps the configuration without instantiating the driver', () => {
		// 1. Registration is lazy: the registry knows the name, but the driver is built on first use, not here
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		// 2. The public accessors see the location while the instance map stays empty
		expect(mockDriver).not.toHaveBeenCalled();
		expect(manager.hasLocation('test-location')).toBe(true);
		expect(manager.locationNames()).toEqual(['test-location']);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Drops the instance of a location registered again', () => {
		// 1. Build an instance from the first registration, so there is something the second one has to replace
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		const first = manager.location('test-location');

		// 2. Re-registering replaces the configuration, so the next use builds afresh from the new options
		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'baz',
			},
		});

		expect(manager.location('test-location')).not.toBe(first);
		expect(mockDriver).toHaveBeenLastCalledWith({ foo: 'baz' });
	});
});

describe('#location', () => {
	test('Throws error when the location does not exist', () => {
		// 1. A missing name is a configuration bug and is reported as such rather than answered with `undefined`
		const manager = new DriverManager();

		expect(() => manager.location('test-location')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "test-location" doesn't exist.]`,
		);
	});

	test('Instantiates the driver with the options alone on first use, then reuses it', () => {
		// 1. The first `location()` call is what builds: the constructor receives the options object and nothing else
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		const first = manager.location('test-location');

		// 2. Every later call answers with the same instance without building again
		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
		expect(first).toBe(mockDriver.mock.instances[0]);
		expect(manager.location('test-location')).toBe(first);
		expect(mockDriver).toHaveBeenCalledOnce();
		expect([...manager.instantiated().keys()]).toEqual(['test-location']);
	});
});

describe('#close', () => {
	test('Closes the drivers built so far that have a close(), and leaves the rest alone', async () => {
		// 1. Two driver classes: one holding connections, with a `close()`, one without — both are valid drivers
		const built = vi.fn();
		const closed = vi.fn();

		/**
		 * A driver that holds connections, the way an SDK-backed one does.
		 */
		class Closable {
			/**
			 * Record the construction, so the test can tell a rebuilt location from a reused one.
			 */
			constructor() {
				// 1. A shared spy rather than a field: the manager owns the instances, the test only sees the counts
				built();
			}

			/**
			 * Record the shutdown.
			 *
			 * @returns Once the shutdown is recorded.
			 */
			async close(): Promise<void> {
				// 1. The same spy pattern as the constructor, so a close on a never-built location would show up as a call
				closed();
			}
		}

		const plain = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('closable', Closable);
		manager.registerDriver('plain', plain);
		manager.registerLocation('a', { driver: 'closable', options: {} });
		manager.registerLocation('b', { driver: 'plain', options: {} });
		manager.registerLocation('never-used', { driver: 'closable', options: {} });

		// 2. Only `a` and `b` are built; `never-used` has no instance and must not be built just to be closed
		manager.location('a');
		manager.location('b');

		await manager.close();

		expect(closed).toHaveBeenCalledOnce();
		expect(built).toHaveBeenCalledOnce();

		// 3. The registrations survive, the instances do not: the next use builds afresh
		expect(manager.locationNames()).toEqual(['a', 'b', 'never-used']);
		expect(manager.instantiated().size).toBe(0);
		manager.location('a');
		expect(built).toHaveBeenCalledTimes(2);
	});
});
