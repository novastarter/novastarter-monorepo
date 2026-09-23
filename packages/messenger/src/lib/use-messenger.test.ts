/**
 * Tests of `messenger/lib/use-messenger`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { MessengerManager } from './messenger-manager.js';
import { useMessenger } from './use-messenger.js';

afterEach(() => {
	useMessenger.reset();
});

describe('useMessenger', () => {
	test('Returns the same manager on every call, and a fresh one after a reset', () => {
		// 1. Built on the first call, cached for every later one
		const first = useMessenger();

		expect(first).toBeInstanceOf(MessengerManager);
		expect(useMessenger()).toBe(first);

		useMessenger.reset();

		expect(useMessenger()).not.toBe(first);
	});
});
