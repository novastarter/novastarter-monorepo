/**
 * Tests of `storage/lib/use-storage`: one manager per process, resettable through `_cache`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { StorageManager } from './storage-manager.js';
import { _cache, useStorage } from './use-storage.js';

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './storage-manager.js' {
	interface StorageDrivers {
		'test-driver': Record<string, unknown>;
	}
}

afterEach(() => {
	_cache.storage = undefined;
});

describe('useStorage', () => {
	test('Returns the same empty manager on every call', () => {
		// 1. Nothing is built until asked, and every later call returns the cached instance
		const first = useStorage();

		expect(first).toBeInstanceOf(StorageManager);
		expect(useStorage()).toBe(first);
	});

	test('Shares the registrations with every later caller', () => {
		// 1. Registrations made at start-up are visible everywhere, and a location is built once
		const mockDriver = vi.fn();

		useStorage().registerDriver('test-driver', mockDriver);

		useStorage().registerLocation('uploads', {
			driver: 'test-driver',
			options: {},
		});

		expect(useStorage().location('uploads')).toBe(useStorage().location('uploads'));
	});
});
