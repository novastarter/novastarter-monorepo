/**
 * Tests of `database/lib/database-manager`.
 */
import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import type { DatabaseDriver } from '../driver.js';
import { DatabaseManager } from './database-manager.js';

/**
 * What the typed location of the tests answers with.
 */
type TypedDb = { dialect: 'test' };

// The test driver joins the driver map the way a driver package does, and one location joins the location map the way
// an application does, so the registrations and the typed `location()` type-check
declare module './database-manager.js' {
	interface DatabaseDrivers {
		'test-driver': Record<string, unknown>;
	}

	interface DatabaseLocations {
		typed: TypedDb;
	}
}

describe('#registerDriver', () => {
	test('Saves registered drivers locally', () => {
		// 1. A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new DatabaseManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// 2. Inspect the private map directly, since the public API offers no way to list registrations
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new DatabaseManager();

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

		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				connection: 'postgresql://localhost/app',
			},
		});

		// 2. Registration keeps the configuration only; the first use builds the driver from `options` alone
		expect(mockDriver).not.toHaveBeenCalled();

		manager.location('test-location');

		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ connection: 'postgresql://localhost/app' });
		expect(manager.instantiated().get('test-location')).toBeInstanceOf(mockDriver);
	});
});

describe('#location', () => {
	test(`Throws error if location is used that wasn't registered`, () => {
		const manager = new DatabaseManager();

		// 1. An unknown name must throw rather than return `undefined`, since callers chain `.db` on the result
		expect(() => manager.location('missing')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "missing" doesn't exist.]`,
		);
	});

	test('Returns driver instance of registered location', () => {
		const mockDriver = vi.fn();

		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {},
		});

		// 1. The public getter must hand back the same instance that registration created, and the default location
		//    is what a call without a name asks for
		expect(manager.location('test-location')).toBeInstanceOf(mockDriver);
		expect(() => manager.location()).toThrowErrorMatchingInlineSnapshot(`[Error: Location "default" doesn't exist.]`);
	});

	test('Types the db of a location by the augmented map, unknown for the others', () => {
		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', vi.fn());

		// 1. Three locations on the one driver, so every call below resolves at runtime as well as at the type level
		for (const name of ['typed', 'other', 'default']) {
			manager.registerLocation(name, { driver: 'test-driver', options: {} });
		}

		// 2. A name in the map narrows `db`; a name outside it, and the default one, stay `unknown` — the manager
		//    changes nothing at runtime, so only the types are checked
		expectTypeOf(manager.location('typed')).toEqualTypeOf<DatabaseDriver<TypedDb>>();
		expectTypeOf(manager.location('typed').db).toEqualTypeOf<TypedDb>();
		expectTypeOf(manager.location('other').db).toEqualTypeOf<unknown>();
		expectTypeOf(manager.location().db).toEqualTypeOf<unknown>();
	});
});
