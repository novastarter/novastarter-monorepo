/**
 * Tests of the FCM driver with the Firebase SDK mocked. The service account reading, the message mapping and the
 * error translation have their own tests next to `read-service-account.ts`, `to-fcm-message.ts` and
 * `describe-error.ts`.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { PushDriverFcm } from './driver.js';

/**
 * Stands in for `Messaging.send()`; resolves the message name or rejects the way FCM does.
 */
const send = vi.fn();

/**
 * Stands in for `Credential.getAccessToken()`; what `verify()` proves the credentials with.
 */
const getAccessToken = vi.fn();

/**
 * Stands in for firebase-admin's `cert()`; hands out the access-token spy as the credential.
 */
const cert = vi.fn(() => ({ getAccessToken }));

/**
 * Stands in for firebase-admin's `initializeApp()`; echoes the name and options so the test can read them back.
 */
const initializeApp = vi.fn((options: unknown, name: string) => ({ name, options }));

/**
 * Stands in for firebase-admin's `deleteApp()`; records which app `close()` releases.
 */
const deleteApp = vi.fn();

vi.mock('firebase-admin/app', () => ({
	cert: (...args: unknown[]) => cert(...(args as [])),
	initializeApp: (...args: [unknown, string]) => initializeApp(...args),
	deleteApp: (...args: unknown[]) => deleteApp(...args),
}));

vi.mock('firebase-admin/messaging', () => ({
	getMessaging: () => ({ send }),
}));

/**
 * An error the way the SDK throws one: a `FirebaseError` with a `messaging/…` code.
 *
 * @param code - The code.
 * @param message - Its message.
 * @returns The error.
 */
const firebaseError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/**
 * A service account the way the Firebase console downloads it: snake_case fields, the key's newlines escaped as an
 * `.env` line carries them.
 */
const account = { project_id: 'proj', client_email: 'sa@proj.iam.gserviceaccount.com', private_key: 'LINE1\\nLINE2' };

afterEach(() => {
	vi.clearAllMocks();
});

describe('PushDriverFcm', () => {
	test('Builds its own Firebase app on the service account and refuses an incomplete one', () => {
		const driver = new PushDriverFcm({ serviceAccount: JSON.stringify(account) });

		// 1. The credential is `cert()` of the account, the app named apart from the application's own
		expect(cert).toHaveBeenCalledWith({
			projectId: 'proj',
			clientEmail: 'sa@proj.iam.gserviceaccount.com',
			privateKey: 'LINE1\nLINE2',
		});

		expect(initializeApp).toHaveBeenCalledWith(
			{ credential: { getAccessToken }, projectId: 'proj' },
			expect.stringMatching(/^novastarter-push-/),
		);

		// 2. A missing field is a configuration error, reported by the options' names
		expect(driver.platforms).toStrictEqual(['fcm']);
		expect(() => new PushDriverFcm({ projectId: 'p', clientEmail: 'c' })).toThrow(/"serviceAccount"/);
	});

	test('Sends and answers the message name; reports a dead token as gone and the rest as errors with the cause', async () => {
		const driver = new PushDriverFcm({ messaging: { send }, credential: { getAccessToken } });
		const message = { token: 'tok', title: 'Hi' };

		// 1. An injected messaging client means no Firebase app of our own
		expect(initializeApp).not.toHaveBeenCalled();

		// 2. FCM's message name is the id
		send.mockResolvedValueOnce('projects/proj/messages/1');
		expect(await driver.send(message)).toStrictEqual({ messageId: 'projects/proj/messages/1', status: 'accepted' });
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok', notification: { title: 'Hi' } }));

		// 3. The two codes that mean the token is dead, and an `invalid-argument` about the token itself
		send.mockRejectedValueOnce(
			firebaseError('messaging/registration-token-not-registered', 'Requested entity was not found.'),
		);

		await expect(driver.send(message)).rejects.toBeInstanceOf(PushTargetGoneError);

		send.mockRejectedValueOnce(
			firebaseError('messaging/invalid-argument', 'The registration token is not a valid FCM registration token'),
		);

		await expect(driver.send(message)).rejects.toBeInstanceOf(PushTargetGoneError);

		// 4. Any other refusal names the code, the SDK's error as the cause; a network failure is prefixed
		const refused = firebaseError('messaging/invalid-argument', 'Invalid data payload key');

		send.mockRejectedValueOnce(refused);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'FCM messaging/invalid-argument: Invalid data payload key',
			cause: refused,
		});

		send.mockRejectedValueOnce(new Error('ECONNRESET'));
		await expect(driver.send(message)).rejects.toThrow('FCM: ECONNRESET');

		// 5. A subscription is the webpush driver's business
		await expect(
			driver.send({ subscription: { endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow(/needs a token/);
	});

	test('Verifies by fetching an access token and releases its app on close', async () => {
		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. The token request is the proof; Google's refusal is named
		getAccessToken.mockResolvedValueOnce({ access_token: 't', expires_in: 3600 });
		await expect(driver.verify()).resolves.toBeUndefined();

		getAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));
		await expect(driver.verify()).rejects.toThrow('FCM credentials are invalid: invalid_grant');

		// 2. Only an app of our own is deleted; an injected client leaves nothing to close
		await driver.close();

		expect(deleteApp).toHaveBeenCalledWith(
			expect.objectContaining({ name: expect.stringMatching(/^novastarter-push-/) }),
		);

		await expect(
			new PushDriverFcm({ messaging: { send }, credential: { getAccessToken } }).close(),
		).resolves.toBeUndefined();
	});

	test('Is the default export too', () => {
		// 1. Both import forms hand out the same class
		expect(defaultExport).toBe(PushDriverFcm);
	});
});
