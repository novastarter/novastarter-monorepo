/**
 * Tests of the Web Push driver with `sendNotification` stubbed; the VAPID signing runs for real.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { describe, expect, test, vi } from 'vitest';
import webpush, { WebPushError } from 'web-push';
import defaultExport, { describeError, PushDriverWebPush, toRequestOptions, toTopic } from './index.js';

const keys = webpush.generateVAPIDKeys();
const subject = 'mailto:ops@example.com';
const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

/**
 * A driver on a stubbed `sendNotification`.
 *
 * @param config - Overrides.
 * @returns The driver and the stub.
 */
const build = (config: Record<string, unknown> = {}) => {
	// 1. The stub records the request; the VAPID signing of `verify()` still runs on the real keys
	const sendNotification = vi.fn();
	const driver = new PushDriverWebPush({ ...keys, subject, sendNotification, ...config });

	return { driver, sendNotification };
};

describe('toTopic / toRequestOptions', () => {
	test('Makes a Topic header of the tag and maps ttl, urgency and the location defaults', () => {
		// 1. The tag is cut to the URL-safe alphabet and the length limit; an empty result is no header at all
		expect(toTopic('invoice.paid:42')).toBe('invoice_paid_42');
		expect(toTopic('x'.repeat(40))).toHaveLength(32);
		expect(toTopic('')).toBeUndefined();
		expect(toTopic('::')).toBe('__');

		// 2. Every option maps to the library's key; the message's ttl wins, the location's fills in
		expect(
			toRequestOptions(
				{ subscription, title: 'Hi', tag: 'a b', ttl: 60, urgency: 'high' },
				{ ...keys, subject, timeout: 5000, proxy: 'http://proxy:3128' },
			),
		).toStrictEqual({
			vapidDetails: { subject, ...keys },
			contentEncoding: 'aes128gcm',
			urgency: 'high',
			TTL: 60,
			topic: 'a_b',
			timeout: 5000,
			proxy: 'http://proxy:3128',
		});

		expect(toRequestOptions({ subscription, title: 'Hi' }, { ...keys, subject, ttl: 3600 })).toStrictEqual({
			vapidDetails: { subject, ...keys },
			contentEncoding: 'aes128gcm',
			urgency: 'normal',
			TTL: 3600,
		});
	});
});

describe('PushDriverWebPush', () => {
	test('Refuses missing keys or a subject that is neither mailto: nor https:', () => {
		// 1. Configuration errors are reported by the options' names
		expect(() => new PushDriverWebPush({ publicKey: '', privateKey: 'x', subject })).toThrow(/"publicKey"/);
		expect(() => new PushDriverWebPush({ ...keys, subject: 'ops@example.com' })).toThrow(/"subject"/);

		// 2. An https: subject is as good as a mailto: one; the public key is what the browser subscribes with
		expect(new PushDriverWebPush({ ...keys, subject: 'https://example.com' }).applicationServerKey).toBe(
			keys.publicKey,
		);
	});

	test('Posts the JSON payload with the VAPID details and answers the status', async () => {
		const { driver, sendNotification } = build();

		// 1. The push service's status is the result; the payload is the service worker's JSON
		sendNotification.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });

		expect(await driver.send({ subscription, title: 'Paid', body: 'Invoice #1', url: '/billing' })).toStrictEqual({
			status: '201',
		});

		expect(sendNotification).toHaveBeenCalledWith(
			subscription,
			JSON.stringify({ title: 'Paid', body: 'Invoice #1', data: { url: '/billing' } }),
			expect.objectContaining({ vapidDetails: { subject, ...keys }, contentEncoding: 'aes128gcm' }),
		);

		// 2. A token is the other drivers' business
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toThrow(/needs a subscription/);
	});

	test('Reports a 404 / 410 as a gone target and any other answer or failure as an error with the cause', async () => {
		const { driver, sendNotification } = build();

		// 1. A 410 is the subscription's end: the error the caller deletes it on
		sendNotification.mockRejectedValueOnce(
			new WebPushError('Received unexpected response code', 410, {}, '', subscription.endpoint),
		);

		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toBeInstanceOf(PushTargetGoneError);

		// 2. Any other status names itself and the body, the library's error as the cause
		const refused = new WebPushError(
			'Received unexpected response code',
			413,
			{},
			'payload too large',
			subscription.endpoint,
		);

		sendNotification.mockRejectedValueOnce(refused);

		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toMatchObject({
			message: 'Web push: 413 from https://push.example/abc: payload too large',
			cause: refused,
		});

		// 3. A network failure is prefixed and passed on; a 404 is as gone as a 410
		sendNotification.mockRejectedValueOnce(new Error('Socket timeout'));
		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toThrow('Web push: Socket timeout');

		expect(describeError(new WebPushError('x', 404, {}, '', 'https://e'))).toMatchObject({
			extensions: { platform: 'webpush', reason: '404 from https://e' },
		});
	});

	test('Verifies the key pair by signing, failing on keys that are not a pair', async () => {
		// 1. A generated pair passes
		await expect(build().driver.verify()).resolves.toBeUndefined();

		// 2. A private key of another pair, or a key that does not decode, fails before any push does
		const other = webpush.generateVAPIDKeys();

		await expect(build({ privateKey: other.privateKey }).driver.verify()).rejects.toThrow(/VAPID keys are invalid/);
		await expect(build({ publicKey: 'not-a-key' }).driver.verify()).rejects.toThrow(/VAPID keys are invalid/);
	});

	test('Is the default export too', () => {
		// 1. Both import forms hand out the same class
		expect(defaultExport).toBe(PushDriverWebPush);
	});
});
