/**
 * Tests of the `console` push driver.
 */
import { describe, expect, test, vi } from 'vitest';
import { PushDriverConsole } from './console.js';

/**
 * A browser subscription with everything `platformOf()` checks for; its endpoint is what the log line names.
 */
const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('PushDriverConsole', () => {
	test('Logs a web push with its endpoint and hands out sequential ids', async () => {
		// 1. A recording logger stands in for the application's
		const logger = { info: vi.fn() };
		const driver = new PushDriverConsole({ logger: logger as any });

		const first = await driver.send({ subscription, title: 'Paid', body: 'Invoice #1', url: '/billing' });
		const second = await driver.send({ subscription, title: 'Again' });

		// 2. The result counts the sends; the log line carries the platform, the target and the text
		expect(first).toStrictEqual({ messageId: 'console-1', status: 'logged' });
		expect(second).toStrictEqual({ messageId: 'console-2', status: 'logged' });

		expect(logger.info).toHaveBeenNthCalledWith(
			1,
			{
				platform: 'webpush',
				target: subscription.endpoint,
				title: 'Paid',
				body: 'Invoice #1',
				url: '/billing',
				messageId: 'console-1',
			},
			`Push (webpush) to ${subscription.endpoint}: Paid — Invoice #1`,
		);
	});

	test('Logs a token of either platform', async () => {
		const logger = { info: vi.fn() };
		const driver = new PushDriverConsole({ logger: logger as any });

		// 1. Every platform is accepted: an FCM token and an APNs token both land in the log with their platform
		await driver.send({ token: 'fcm-token', title: 'Hi' });
		await driver.send({ token: 'apns-token', platform: 'apns', title: 'Hi' });

		expect(driver.platforms).toStrictEqual(['webpush', 'fcm', 'apns']);

		expect(logger.info).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ platform: 'fcm', target: 'fcm-token' }),
			'Push (fcm) to fcm-token: Hi',
		);

		expect(logger.info).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ platform: 'apns', target: 'apns-token' }),
			'Push (apns) to apns-token: Hi',
		);
	});
});
