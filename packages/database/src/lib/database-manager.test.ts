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
		// A bare mock stands in for a driver class: registration only stores it and never instantiates it
		const manager = new DatabaseManager();
		const mockDriver = vi.fn();
		manager.registerDriver('test-driver', mockDriver);

		// Inspect the private map directly, since the public API offers no way to list registrations
		expect(manager['drivers'].size).toBe(1);
		expect(manager['drivers'].get('test-driver')).toBe(mockDriver);
	});
});

describe('#registerLocation', () => {
	test('Throws error when registering location with missing driver', () => {
		const manager = new DatabaseManager();

		// No driver was registered, so the lookup by name must fail before any instantiation happens
		expect(() =>
			manager.registerLocation('test-driver', {
				driver: 'test-driver',
				options: {},
			}),
		).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The "test-driver" driver isn't registered; call registerDriver() with it before a location uses it.]`,
		);
	});

	test('Instantiates the driver with the passed options on first use', () => {
		// `vi.fn()` is constructible, so it records how the manager calls `new Driver(...)`
		const mockDriver = vi.fn();

		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('test-location', {
			driver: 'test-driver',
			options: {
				connection: 'postgresql://localhost/app',
			},
		});

		// Registration keeps the configuration only; the first use builds the driver from `options` alone
		expect(mockDriver).not.toHaveBeenCalled();

		manager.location('test-location');

		// The location's name arrives as the label the driver's log lines carry
		expect(mockDriver).toHaveBeenCalledOnce();
		expect(mockDriver).toHaveBeenCalledWith({ connection: 'postgresql://localhost/app', label: 'test-location' });
		expect(manager.instantiated().get('test-location')).toBeInstanceOf(mockDriver);
	});

	test("Keeps a label the caller chose and leaves the caller's object untouched", () => {
		const mockDriver = vi.fn();
		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', mockDriver);

		// The caller's config is not mutated: a config object reused for two locations must not carry the first name
		const config = { driver: 'test-driver' as const, options: { label: 'primary' } };

		manager.registerLocation('test-location', config);
		manager.location('test-location');

		expect(mockDriver).toHaveBeenCalledWith({ label: 'primary' });
		expect(config).toStrictEqual({ driver: 'test-driver', options: { label: 'primary' } });
	});
});

describe('#location', () => {
	test(`Throws error if location is used that wasn't registered`, () => {
		const manager = new DatabaseManager();

		// An unknown name must throw rather than return `undefined`, since callers chain `.db` on the result
		expect(() => manager.location('missing')).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Location "missing" doesn't exist; register it with registerLocation() before using it.]`,
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

		expect(manager.location('test-location')).toBeInstanceOf(mockDriver);

		expect(() => manager.location()).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Location "default" doesn't exist; register it with registerLocation() before using it.]`,
		);
	});

	test('Types the db of a location by the augmented map, unknown for the others', () => {
		const manager = new DatabaseManager();

		manager.registerDriver('test-driver', vi.fn());

		// Three locations on the one driver, so every call below resolves at runtime as well as at the type level
		for (const name of ['typed', 'other', 'default']) {
			manager.registerLocation(name, { driver: 'test-driver', options: {} });
		}

		// A name in the map narrows `db`; a name outside it, and the default one, stay `unknown` — the manager
		// changes nothing at runtime, so only the types are checked
		expectTypeOf(manager.location('typed')).toEqualTypeOf<DatabaseDriver<TypedDb>>();
		expectTypeOf(manager.location('typed').db).toEqualTypeOf<TypedDb>();
		expectTypeOf(manager.location('other').db).toEqualTypeOf<unknown>();
		expectTypeOf(manager.location().db).toEqualTypeOf<unknown>();
	});
});
