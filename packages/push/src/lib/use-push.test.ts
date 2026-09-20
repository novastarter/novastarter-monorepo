/**
 * Tests of `push/lib/use-push`: one manager per process, resettable through `_cache`.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PushManager } from './push-manager.js';
import { _cache, usePush } from './use-push.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	_cache.push = undefined;
});

describe('usePush', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Nothing is built until asked, so a process that never pushes never constructs a manager
		expect(_cache.push).toBeUndefined();

		const manager = usePush();

		expect(manager).toBeInstanceOf(PushManager);
		expect(_cache.push).toBe(manager);

		// 2. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		expect(usePush()).toBe(manager);
	});
});
