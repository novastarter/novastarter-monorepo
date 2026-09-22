/**
 * Tests of the Web Push driver with `web-push`'s `sendNotification` stubbed; the VAPID signing runs for real. The
 * option mapping and the error translation have their own tests next to `to-request-options.ts` and
 * `describe-error.ts`.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush, { WebPushError } from 'web-push';
import defaultExport from '../index.js';
import { PushDriverWebPush } from './driver.js';

/**
 * A real VAPID pair, so `verify()` signs for real.
 */
const keys = webpush.generateVAPIDKeys();

/**
 * A `mailto:` subject, the form every push service accepts.
 */
const subject = 'mailto:ops@example.com';

/**
 * A browser subscription with placeholder keys; the stub never encrypts for them.
 */
const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

/**
 * Spy standing in for `web-push`'s `sendNotification()`, so a test can script the push service's answer.
 *
 * Hoisted because `vi.mock` factories run before the imports of this file are evaluated.
 */
const sendNotification = vi.hoisted(() => vi.fn());

vi.mock('web-push', async (importOriginal) => {
	// The types know no default export, but the library is CommonJS: at runtime the namespace carries the module
	// itself as `default`
	const actual = (await importOriginal()) as Record<string, unknown> & { default: Record<string, unknown> };

	return {
		...actual,
		// The driver's default import and its named export are both routed to the stub
		default: { ...actual.default, sendNotification },
		sendNotification,
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * A driver on the stubbed library.
 *
 * @param config - Overrides.
 * @returns The driver and the stub.
 */
const build = (config: Record<string, unknown> = {}) => {
	// 1. The stub records the request; the VAPID signing of `verify()` still runs on the real keys
	const driver = new PushDriverWebPush({ ...keys, subject, ...config });

	return { driver, sendNotification };
};

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

	test('Reports a gone target and any other answer or failure as an error with the cause', async () => {
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

		// 3. A network failure is prefixed and passed on
		sendNotification.mockRejectedValueOnce(new Error('Socket timeout'));
		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toThrow('Web push: Socket timeout');
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
