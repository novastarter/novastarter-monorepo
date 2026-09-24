/**
 * Tests of the `console` push driver.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { PushDriverConsole } from './console.js';

/**
 * A browser subscription with everything `platformOf()` checks for; its endpoint is what the log line names.
 */
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

describe('PushDriverConsole', () => {
	test('Logs a web push with its endpoint and hands out sequential ids', async () => {
		const logger = { info: vi.fn() };
		const driver = new PushDriverConsole({ logger: logger as unknown as Logger });

		const first = await driver.send({ subscription, title: 'Paid', body: 'Invoice #1', url: '/billing' });
		const second = await driver.send({ subscription, title: 'Again' });

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
		const driver = new PushDriverConsole({ logger: logger as unknown as Logger });

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

	test('Logs a call with its method and parameters, files by name, and answers nothing', async () => {
		const logger = { info: vi.fn() };

		// The options stay out of the log
		await expect(
			new PushDriverConsole({ logger: logger as unknown as Logger }).call(
				'POST /v1/files',
				{ purpose: 'import', file: new File(['x'], 'data.csv'), raw: new Blob(['y']) },
				{ headers: { authorization: 'secret' } },
			),
		).resolves.toStrictEqual({ status: 200, headers: {}, data: undefined });

		expect(logger.info).toHaveBeenCalledWith(
			{ method: 'POST /v1/files', params: { purpose: 'import', file: 'data.csv', raw: 'blob' } },
			'Push call POST /v1/files',
		);
	});

	test('Answers a plain 200 with no headers and no body', async () => {
		// Code that reads the status of a real provider's answer runs against the console too
		await expect(
			new PushDriverConsole({ logger: { info: vi.fn() } as unknown as Logger }).call('GET /v1/x'),
		).resolves.toStrictEqual({
			status: 200,
			headers: {},
			data: undefined,
		});
	});
});
