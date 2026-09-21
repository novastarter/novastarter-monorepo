/**
 * Tests of `push/lib/use-push`: one manager per process, resettable.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PushManager } from './push-manager.js';
import { usePush } from './use-push.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	usePush.reset();
});

describe('usePush', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = usePush();

		expect(manager).toBeInstanceOf(PushManager);
		expect(usePush()).toBe(manager);

		// 2. `reset()` drops it, so the next test starts from an empty manager
		usePush.reset();
		expect(usePush()).not.toBe(manager);
	});
});
