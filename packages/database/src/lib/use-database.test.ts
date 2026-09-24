/**
 * Tests of `database/lib/use-database`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DatabaseManager } from './database-manager.js';
import { useDatabase } from './use-database.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './database-manager.js' {
	interface DatabaseDrivers {
		'test-driver': Record<string, unknown>;
	}
}

afterEach(() => {
	useDatabase.reset();
});

describe('useDatabase', () => {
	test('Returns the same empty manager on every call', () => {
		const first = useDatabase();

		expect(first).toBeInstanceOf(DatabaseManager);
		expect(useDatabase()).toBe(first);
	});

	test('Shares the registrations with every later caller', () => {
		const mockDriver = vi.fn();

		useDatabase().registerDriver('test-driver', mockDriver);

		useDatabase().registerLocation('default', {
			driver: 'test-driver',
			options: {},
		});

		expect(useDatabase().location()).toBe(useDatabase().location('default'));
	});
});
