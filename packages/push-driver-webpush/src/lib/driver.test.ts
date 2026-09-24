/**
 * Tests of the Web Push driver with `web-push`'s `sendNotification` stubbed; the VAPID signing runs for real. The
 * option mapping and the error translation have their own tests next to `to-request-options.ts` and
 * `describe-error.ts`.
 */
import { InvalidConfigError, InvalidPayloadError } from '@novastarter/errors';
import { PushTargetGoneError } from '@novastarter/push';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush, { WebPushError } from 'web-push';
import { PushDriverWebPush as EntryExport } from '../index.js';
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
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

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
	// The stub records the request; the VAPID signing of `verify()` still runs on the real keys
	const driver = new PushDriverWebPush({ ...keys, subject, ...config });

	return { driver, sendNotification };
};

describe('PushDriverWebPush', () => {
	test('Refuses missing keys or a subject that is neither mailto: nor https:', () => {
		expect(() => new PushDriverWebPush({ publicKey: '', privateKey: 'x', subject })).toThrow(/"publicKey"/);
		expect(() => new PushDriverWebPush({ publicKey: '', privateKey: 'x', subject })).toThrow(InvalidConfigError);
		expect(() => new PushDriverWebPush({ ...keys, subject: 'ops@example.com' })).toThrow(/"subject"/);

		// An https: subject is as good as a mailto: one; the public key is what the browser subscribes with
		expect(new PushDriverWebPush({ ...keys, subject: 'https://example.com' }).applicationServerKey).toBe(
			keys.publicKey,
		);
	});

	test('Refuses malformed keys at construction, before any send', () => {
		// The usual copy-paste mistakes (a truncated key, padding characters, a key that decodes to the wrong length) must
		// fail here at registration, not on every send with the library's raw error
		expect(() => new PushDriverWebPush({ ...keys, publicKey: keys.publicKey.slice(0, 10), subject })).toThrow(
			/URL-safe base64 of the right length/,
		);

		expect(() => new PushDriverWebPush({ ...keys, publicKey: `${keys.publicKey}=`, subject })).toThrow(
			/URL-safe base64 of the right length/,
		);

		expect(() => new PushDriverWebPush({ ...keys, privateKey: 'not-a-key', subject })).toThrow(
			/URL-safe base64 of the right length/,
		);

		// The library's own complaint stays on as the cause, naming the key it rejects
		try {
			new PushDriverWebPush({ ...keys, privateKey: 'not-a-key', subject });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidConfigError);
			expect((error as Error).cause).toBeInstanceOf(Error);
			expect(((error as Error).cause as Error).message).toMatch(/Vapid private key/);
		}
	});

	test('Posts the JSON payload with the VAPID details and answers the status', async () => {
		const { driver, sendNotification } = build();

		sendNotification.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });

		expect(await driver.send({ subscription, title: 'Paid', body: 'Invoice #1', url: '/billing' })).toStrictEqual({
			status: '201',
		});

		expect(sendNotification).toHaveBeenCalledWith(
			subscription,
			JSON.stringify({ title: 'Paid', body: 'Invoice #1', data: { url: '/billing' } }),
			expect.objectContaining({ vapidDetails: { subject, ...keys }, contentEncoding: 'aes128gcm' }),
		);

		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toThrow(/needs a subscription/);
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toThrow(InvalidPayloadError);
	});

	test('Refuses an endpoint off the browser push services without posting, even when called directly', async () => {
		const { driver, sendNotification } = build();

		// `location(name).send()` skips `sendPush()`, so the driver checks the client-supplied endpoint itself
		for (const endpoint of ['https://10.0.0.5:8443/x', 'https://internal-admin.svc.cluster.local/api/reset']) {
			await expect(driver.send({ subscription: { ...subscription, endpoint }, title: 'Hi' })).rejects.toThrow(
				/not a known push service/,
			);
		}

		expect(sendNotification).not.toHaveBeenCalled();
	});

	test('Reports a gone target and any other answer or failure as an error with the cause', async () => {
		const { driver, sendNotification } = build();

		sendNotification.mockRejectedValueOnce(
			new WebPushError('Received unexpected response code', 410, {}, '', subscription.endpoint),
		);

		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toBeInstanceOf(PushTargetGoneError);

		const refused = new WebPushError(
			'Received unexpected response code',
			413,
			{},
			'payload too large',
			subscription.endpoint,
		);

		sendNotification.mockRejectedValueOnce(refused);

		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toMatchObject({
			message: 'Web push: 413 from https://fcm.googleapis.com/fcm/send/abc: payload too large',
			cause: refused,
		});

		sendNotification.mockRejectedValueOnce(new Error('Socket timeout'));
		await expect(driver.send({ subscription, title: 'Hi' })).rejects.toThrow('Web push: Socket timeout');
	});

	test('Verifies the key pair by signing, failing on keys that are not a pair', async () => {
		await expect(build().driver.verify()).resolves.toBeUndefined();

		// A private key of another pair fails before any push does; keys that do not parse never reach `verify()`, the
		// constructor refuses them
		const other = webpush.generateVAPIDKeys();

		await expect(build({ privateKey: other.privateKey }).driver.verify()).rejects.toThrow(/not a pair/);
		await expect(build({ privateKey: other.privateKey }).driver.verify()).rejects.toThrow(InvalidConfigError);
	});

	test('Is exported by name from the entry point', () => {
		expect(EntryExport).toBe(PushDriverWebPush);
	});
});
