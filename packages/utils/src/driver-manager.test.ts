/**
 * Tests of `utils/driver-manager`.
 */
import { describe, expect, test, vi } from 'vitest';
import { DriverManager, mergeCallOptions } from './driver-manager.js';

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new DriverManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// Inspect the private map directly, since the public API offers no way to list drivers
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
		expect(mockDriver).not.toHaveBeenCalled();
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		// The driver name is checked at registration, so a typo in a location config fails at startup, not on first use
		const manager = new DriverManager();

		expect(() =>
			manager.registerLocation('test-location', {
				driver: 's3',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The "s3" driver isn't registered; call registerDriver() with it before a location uses it.]`,
		);
	});

	test('Keeps the configuration without instantiating the driver', () => {
		// Registration is lazy: the registry knows the name, but the driver is built on first use, not here
		const mockDriver = vi.fn();
		const manager = new DriverManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				foo: 'bar',
			},
		});

		// The public accessors see the location while the instance map stays empty
		expect(mockDriver).not.toHaveBeenCalled();
		expect(manager.hasLocation('test-location')).toBe(true);
		expect(manager.locationNames()).toEqual(['test-location']);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Drops the instance of a location registered again', () => {
		// Build an instance from the first registration, so there is something the second one has to replace
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

		// Re-registering replaces the configuration, so the next use builds afresh from the new options
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
		// A missing name is a configuration bug and is reported as such rather than answered with `undefined`
		const manager = new DriverManager();

		expect(() => manager.location('test-location')).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Location "test-location" doesn't exist; register it with registerLocation() before using it.]`,
		);
	});

	test('Instantiates the driver with the options alone on first use, then reuses it', () => {
		// The first `location()` call is what builds: the constructor receives the options object and nothing else
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

		// Every later call answers with the same instance without building again
		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ foo: 'bar' });
		expect(first).toBe(mockDriver.mock.instances[0]);
		expect(manager.location('test-location')).toBe(first);
		expect(mockDriver).toHaveBeenCalledOnce();
		expect([...manager.instantiated().keys()]).toEqual(['test-location']);
	});
});

describe('location call defaults', () => {
	/**
	 * A driver whose `call()` answers with what it was given, so the tests can see the merged options.
	 */
	class CallingDriver {
		/**
		 * Echo the call.
		 *
		 * @param method - The method.
		 * @param params - The parameters.
		 * @param options - The options, as the manager merged them.
		 * @returns What the driver got.
		 */
		async call(method: string, params?: Record<string, unknown>, options?: unknown): Promise<unknown> {
			// Echoed, so the assertions read the merge
			return { method, params, options };
		}
	}

	test('Puts the location’s headers and timeout under every call, the call’s own on top', async () => {
		const manager = new DriverManager<CallingDriver & { close?(): Promise<void> }>();

		manager.registerDriver('calling', CallingDriver as never);

		manager.registerLocation('api', {
			driver: 'calling',
			options: {},
			call: { headers: { 'X-Api-Version': '2024-01-01' }, timeout: 5_000 },
		});

		// The call's header joins the location's; its timeout wins; the method and params go through untouched
		await expect(
			manager.location('api').call('GET /x', { a: 1 }, { headers: { 'x-trace': 't' }, timeout: 100 }),
		).resolves.toStrictEqual({
			method: 'GET /x',
			params: { a: 1 },
			options: { headers: { 'x-api-version': '2024-01-01', 'x-trace': 't' }, timeout: 100 },
		});

		expect(manager.location('api')).toBeInstanceOf(CallingDriver);
	});

	test('Leaves a driver alone without call defaults, or without call()', async () => {
		const manager = new DriverManager<object>();

		manager.registerDriver('calling', CallingDriver as never);
		manager.registerDriver('plain', class {} as never);
		manager.registerLocation('bare', { driver: 'calling', options: {} });
		manager.registerLocation('plain', { driver: 'plain', options: {}, call: { timeout: 1 } });

		// No defaults: the prototype's own `call`, options passed as they are
		const bare = manager.location('bare') as CallingDriver;

		expect(Object.hasOwn(bare, 'call')).toBe(false);
		await expect(bare.call('GET /x')).resolves.toMatchObject({ options: undefined });

		// No `call()` to wrap: nothing added
		expect('call' in manager.location('plain')).toBe(false);
	});
});

describe('#close', () => {
	test('Closes the drivers built so far that have a close(), and leaves the rest alone', async () => {
		// Two driver classes: one holding connections, with a `close()`, one without — both are valid drivers
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
				// A shared spy rather than a field: the manager owns the instances, the test only sees the counts
				built();
			}

			/**
			 * Record the shutdown.
			 *
			 * @returns Once the shutdown is recorded.
			 */
			async close(): Promise<void> {
				// The same spy pattern as the constructor, so a close on a never-built location would show up as a call
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

		// Only `a` and `b` are built; `never-used` has no instance and must not be built just to be closed
		manager.location('a');
		manager.location('b');

		await manager.close();

		expect(closed).toHaveBeenCalledOnce();
		expect(built).toHaveBeenCalledOnce();

		// The registrations survive, the instances do not: the next use builds afresh
		expect(manager.locationNames()).toEqual(['a', 'b', 'never-used']);
		expect(manager.instantiated().size).toBe(0);
		manager.location('a');
		expect(built).toHaveBeenCalledTimes(2);
	});
});

describe('mergeCallOptions', () => {
	test('Puts the call’s headers over the location’s, case-insensitively, and prefers the call’s timeout', () => {
		// Both set: the call wins where they overlap, other options pass through
		expect(
			mergeCallOptions(
				{ headers: { 'X-Version': '1', 'Content-Type': 'application/json' }, timeout: 5_000 },
				{ headers: { 'content-type': 'text/plain' }, timeout: 100, accessToken: 't' },
			),
		).toStrictEqual({
			headers: { 'x-version': '1', 'content-type': 'text/plain' },
			timeout: 100,
			accessToken: 't',
		});

		expect(mergeCallOptions({ timeout: 5_000 }, undefined)).toStrictEqual({ timeout: 5_000 });

		const options = { timeout: 1 };

		expect(mergeCallOptions(undefined, options)).toBe(options);
	});
});
