/**
 * Tests of the APNs driver class with the SDK's client mocked; the SDK's own classes (notifications, errors, hosts)
 * are real. The key check, the error mapping and the message mapping are tested in `assert-signing-key.test.ts`,
 * `describe-error.test.ts` and `to-apns-notification.test.ts`.
 */
import { generateKeyPairSync } from 'node:crypto';
import { InvalidConfigError, InvalidPayloadError } from '@novastarter/errors';
import { PushTargetGoneError } from '@novastarter/push';
import { TimeoutError } from '@novastarter/utils';
import { ApnsError, Host, Notification } from 'apns2';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PushDriverApns as EntryExport } from '../index.js';
import { PushDriverApns } from './driver.js';

/**
 * A fresh P-256 key in PEM, the shape of an APNs auth key.
 *
 * @returns The PEM.
 */
const p256Pem = (): string =>
	generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

/**
 * An RSA key in PEM — a private key APNs would refuse.
 *
 * @returns The PEM.
 */
const rsaPem = (): string =>
	generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

/**
 * A valid APNs auth key for the happy path, generated once: key generation is the slow part of these tests.
 */
const signingKey = p256Pem();

/**
 * The mocked client's `send` spy; each test programs its answer.
 */
const send = vi.fn();

/**
 * The mocked client's `close` spy, so a test can check the driver releases the client.
 */
const close = vi.fn();

/**
 * Spy recording the options every `ApnsClient` was built with, so a test can check the credentials and the host.
 */
const construct = vi.fn();

vi.mock('apns2', async (importOriginal) => {
	const actual = await importOriginal<typeof import('apns2')>();

	return {
		...actual,
		/**
		 * Stand-in for the SDK's `ApnsClient`: routes `send()` and `close()` to the shared spies and records the
		 * options, so no test opens a session.
		 */
		ApnsClient: class {
			/**
			 * The request the driver makes, scripted per test with the SDK's answer.
			 *
			 * @internal
			 */
			send = send;

			/**
			 * Session closer, recorded on the shared spy.
			 *
			 * @internal
			 */
			close = close;

			/**
			 * Keep the options instead of opening sessions, so a test can read back what the driver built.
			 *
			 * @param options - The credentials and host the driver passed.
			 */
			constructor(public options: unknown) {
				construct(options);
			}
		},
	};
});

/**
 * A complete configuration; a test overrides the option it is about.
 */
const credentials = { teamId: 'TEAM1', keyId: 'KEY1', signingKey, topic: 'com.example.app' };

/**
 * An `ApnsError` the way the client raises it for a refusal.
 *
 * @param statusCode - The HTTP status APNs answered with.
 * @param reason - Apple's reason string.
 * @returns The error.
 */
const refusal = (statusCode: number, reason: string): ApnsError =>
	new ApnsError({ statusCode, notification: new Notification('tok'), response: { reason, timestamp: Date.now() } });

afterEach(() => {
	vi.clearAllMocks();
});

describe('PushDriverApns', () => {
	test('Requires the credentials and the topic', () => {
		// The key is checked at construction
		expect(() => new PushDriverApns({ ...credentials, teamId: '' })).toThrow(InvalidConfigError);
		expect(() => new PushDriverApns({ ...credentials, teamId: '' })).toThrow('"teamId"');
		expect(() => new PushDriverApns({ ...credentials, topic: '' })).toThrow('"topic"');
		expect(() => new PushDriverApns({ ...credentials, signingKey: rsaPem() })).toThrow('P-256');
	});

	test('Unescapes the key of a .env line and builds the client for production or the sandbox', () => {
		const escaped = signingKey.replace(/\n/g, '\\n');
		const production = new PushDriverApns({ ...credentials, signingKey: escaped });
		const sandbox = new PushDriverApns({ ...credentials, production: false, timeout: 5000 });

		expect(construct).toHaveBeenNthCalledWith(1, {
			team: 'TEAM1',
			keyId: 'KEY1',
			signingKey,
			defaultTopic: 'com.example.app',
			host: Host.production,
		});

		expect(construct).toHaveBeenNthCalledWith(2, {
			team: 'TEAM1',
			keyId: 'KEY1',
			signingKey,
			defaultTopic: 'com.example.app',
			host: Host.development,
		});

		return Promise.all([production.close(), sandbox.close()]);
	});

	test('Sends the notification for the token and answers accepted', async () => {
		send.mockResolvedValueOnce(new Notification('tok'));

		// APNs hands out no id the client exposes, so the result is the status alone
		const driver = new PushDriverApns(credentials);
		const result = await driver.send({ token: 'tok', title: 'Hi', body: 'There', tag: 'счёт-42', platform: 'apns' });

		expect(result).toStrictEqual({ status: 'accepted' });
		expect(send).toHaveBeenCalledTimes(1);

		const notification = send.mock.calls[0]?.[0] as Notification;

		expect(notification.deviceToken).toBe('tok');
		expect(notification.options.topic).toBe('com.example.app');
		expect(notification.options.collapseId).toBe('____-42');
	});

	test('Refuses a subscription, passes a gone token on, names another refusal', async () => {
		const driver = new PushDriverApns(credentials);

		await expect(
			driver.send({ subscription: { endpoint: 'https://p', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow(InvalidPayloadError);

		await expect(
			driver.send({ subscription: { endpoint: 'https://p', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow('needs a token');

		send.mockRejectedValueOnce(refusal(410, 'Unregistered'));
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toBeInstanceOf(PushTargetGoneError);

		send.mockRejectedValueOnce(refusal(429, 'TooManyRequests'));
		await expect(driver.send({ token: 'tok', title: 'Hi' })).rejects.toThrow('APNs 429 TooManyRequests');
	});

	test('Fails a send that outlives the timeout, and waits without one', async () => {
		// The SDK never reads the timeout it is given, so the driver has to race it: a request APNs never answers fails
		// after the deadline, the timeout as the cause
		send.mockReturnValueOnce(new Promise(() => {}));

		const bounded = new PushDriverApns({ ...credentials, timeout: 20 });
		const failure: unknown = await bounded.send({ token: 'tok', title: 'Hi' }).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe('APNs: Timed out after 20 ms');
		expect((failure as Error).cause).toBeInstanceOf(TimeoutError);

		// An answer in time goes through unchanged, so the race costs a bounded send nothing
		send.mockResolvedValueOnce(new Notification('tok'));
		await expect(bounded.send({ token: 'tok', title: 'Hi' })).resolves.toStrictEqual({ status: 'accepted' });

		// Without a deadline the driver waits for the client, however long it takes
		let settled = false;

		send.mockReturnValueOnce(new Promise(() => {}));

		const unbounded = new PushDriverApns(credentials);

		void unbounded.send({ token: 'tok', title: 'Hi' }).then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);

		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(settled).toBe(false);
	});

	test('Closes the client', async () => {
		const driver = new PushDriverApns(credentials);

		await driver.close();
		expect(close).toHaveBeenCalledTimes(1);
	});

	test('Is exported by name from the entry point', () => {
		expect(EntryExport).toBe(PushDriverApns);
	});
});
