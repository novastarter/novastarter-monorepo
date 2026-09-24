/**
 * Tests of `notifications/lib/use-notifications`: registration, the process-wide notifications, and their absence.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Notifications } from './notifications.js';
import { registerNotifications, useNotifications } from './use-notifications.js';

afterEach(() => {
	useNotifications.reset();
});

describe('useNotifications', () => {
	test('Throws before any registration', () => {
		// A forgotten registration fails loudly instead of dropping every notification
		expect(() => useNotifications()).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Notifications are not registered; call registerNotifications() at start-up.]`,
		);
	});
});

describe('registerNotifications', () => {
	test('Makes the registration the process-wide one, and replaces it on a second call', () => {
		registerNotifications({ channels: [], findRecipient: async () => null, render: async () => null });

		const first = useNotifications();

		expect(first).toBeInstanceOf(Notifications);
		expect(useNotifications()).toBe(first);

		// The second registration is the whole configuration
		registerNotifications({
			channels: [{ name: 'mail', reaches: () => true, send: async () => undefined }],
			findRecipient: async () => null,
			render: async () => null,
		});

		expect(useNotifications()).not.toBe(first);
		expect(useNotifications().channelNames()).toStrictEqual(['mail']);
	});
});
