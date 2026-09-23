/**
 * Tests of the FCM driver with the Firebase SDK mocked. The service account reading, the message mapping and the
 * error translation have their own tests next to `read-service-account.ts`, `to-fcm-message.ts` and
 * `describe-error.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { PushTargetGoneError } from '@novastarter/push';
import { TimeoutError } from '@novastarter/utils';
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

/**
 * Stands in for firebase-admin's `getMessaging()`; hands out the send spy as the messaging client.
 */
const getMessaging = vi.fn(() => ({ send }));

vi.mock('firebase-admin/app', () => ({
	cert: (...args: unknown[]) => cert(...(args as [])),
	initializeApp: (...args: [unknown, string]) => initializeApp(...args),
	deleteApp: (...args: unknown[]) => deleteApp(...args),
}));

vi.mock('firebase-admin/messaging', () => ({
	getMessaging: (...args: unknown[]) => getMessaging(...(args as [])),
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

	test('Deletes the half-built Firebase app when the messaging client fails', () => {
		// 1. `getMessaging()` throwing leaves the app in the SDK's global registry, holding live agents; the driver
		//    deletes it, best-effort, before the error propagates
		const failure = new Error('messaging unavailable');

		getMessaging.mockImplementationOnce(() => {
			throw failure;
		});

		deleteApp.mockResolvedValue(undefined);

		expect(() => new PushDriverFcm({ serviceAccount: account })).toThrow(failure);

		expect(deleteApp).toHaveBeenCalledWith(
			expect.objectContaining({ name: expect.stringMatching(/^novastarter-push-/) }),
		);
	});

	test('Sends and answers the message name; reports a dead token as gone and the rest as errors with the cause', async () => {
		const driver = new PushDriverFcm({ serviceAccount: JSON.stringify(account) });
		const message = { token: 'tok', title: 'Hi' };

		// 1. The messaging API of the location's own app is what sends reach
		expect(initializeApp).toHaveBeenCalledWith(
			{ credential: { getAccessToken }, projectId: 'proj' },
			expect.stringMatching(/^novastarter-push-/),
		);

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

	test('Fails a send that outlives the timeout, and waits without one', async () => {
		// 1. The SDK takes no timeout, so the driver races it: a request FCM never answers fails after the deadline, the
		//    timeout as the cause; the request itself runs on — the SDK call cannot be told to stop
		send.mockReturnValueOnce(new Promise(() => {}));

		const bounded = new PushDriverFcm({ serviceAccount: account, timeout: 20 });

		const failure: unknown = await bounded.send({ token: 'tok', title: 'Hi' }).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe('FCM: Timed out after 20 ms');
		expect((failure as Error).cause).toBeInstanceOf(TimeoutError);

		// 2. An answer in time goes through unchanged, so the race costs a bounded send nothing
		send.mockResolvedValueOnce('projects/proj/messages/1');

		expect(await bounded.send({ token: 'tok', title: 'Hi' })).toStrictEqual({
			messageId: 'projects/proj/messages/1',
			status: 'accepted',
		});

		// 3. Without a deadline the driver waits for the client, however long it takes
		let settled = false;

		send.mockReturnValueOnce(new Promise(() => {}));

		const unbounded = new PushDriverFcm({ serviceAccount: account });

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

	test('Verifies by fetching an access token and releases its app on close', async () => {
		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. The token request is the proof; Google's refusal is named
		getAccessToken.mockResolvedValueOnce({ access_token: 't', expires_in: 3600 });
		await expect(driver.verify()).resolves.toBeUndefined();

		getAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));
		await expect(driver.verify()).rejects.toThrow('FCM credentials are invalid: invalid_grant');

		// 2. `close()` releases the location's app
		await driver.close();

		expect(deleteApp).toHaveBeenCalledWith(
			expect.objectContaining({ name: expect.stringMatching(/^novastarter-push-/) }),
		);
	});

	test('Is the default export too', () => {
		// 1. Both import forms hand out the same class
		expect(defaultExport).toBe(PushDriverFcm);
	});
});

describe('PushDriverFcm.call', () => {
	/**
	 * Stands in for the global `fetch` the call goes through; answers what each test scripts.
	 */
	const fetchSpy = vi.fn();

	/**
	 * A response the way `fetch` resolves one.
	 *
	 * @param status - The HTTP status.
	 * @param body - The body, sent as JSON; `undefined` for none.
	 * @param headers - Response headers.
	 * @returns The response.
	 */
	const answer = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
		new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('Sends a JSON body with the bearer token to the project path', async () => {
		// 1. The access token authorises the request; `{projectId}` becomes the service account's project
		vi.stubGlobal('fetch', fetchSpy);
		getAccessToken.mockResolvedValueOnce({ access_token: 'ya29.secret', expires_in: 3600 });
		fetchSpy.mockResolvedValueOnce(answer(200, { name: 'projects/proj/messages/1' }));

		const driver = new PushDriverFcm({ serviceAccount: account });

		const result = await driver.call('POST /v1/projects/{projectId}/messages:send', { message: { topic: 'news' } });

		expect(result).toStrictEqual({ name: 'projects/proj/messages/1' });

		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

		expect(url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send');
		expect(init.method).toBe('POST');
		expect(init.headers['authorization']).toBe('Bearer ya29.secret');
		expect(init.body).toBe(JSON.stringify({ message: { topic: 'news' } }));
	});

	test('Puts the parameters of a GET in the query and adds the caller headers', async () => {
		// 1. A full URL on the Instance ID host is allowed; the caller's header joins the driver's
		vi.stubGlobal('fetch', fetchSpy);
		getAccessToken.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 });
		fetchSpy.mockResolvedValueOnce(answer(200, { rel: {} }));

		const driver = new PushDriverFcm({ serviceAccount: account });

		await driver.call(
			'GET https://iid.googleapis.com/iid/info/abc',
			{ details: true },
			{ headers: { access_token_auth: 'true' } },
		);

		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

		expect(url).toBe('https://iid.googleapis.com/iid/info/abc?details=true');
		expect(init.body).toBeUndefined();
		expect(init.headers['access_token_auth']).toBe('true');
	});

	test('Throws ProviderCallError for an error status and HitRateLimitError for 429, with no token in them', async () => {
		vi.stubGlobal('fetch', fetchSpy);
		getAccessToken.mockResolvedValue({ access_token: 'ya29.secret', expires_in: 3600 });

		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. Google's error answer is kept with its status; the message names the reason, never the token
		const refusal = { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } };

		fetchSpy.mockResolvedValueOnce(answer(404, refusal));

		const error = await driver.call('GET /v1/projects/{projectId}/x').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'fcm', status: 404, body: refusal } });
		expect((error as Error).message).toContain('Requested entity was not found.');
		expect((error as Error).message).not.toContain('ya29.secret');

		// 2. Too many requests is a rate limit the caller may wait out
		fetchSpy.mockResolvedValueOnce(answer(429, { error: { message: 'Quota exceeded' } }, { 'retry-after': '5' }));

		await expect(driver.call('GET /v1/projects/{projectId}/x')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a foreign host before fetching a token or making a request', async () => {
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. The token would go wherever the URL points, so a foreign host is refused first
		await expect(driver.call('GET https://evil.example/steal')).rejects.toThrow(/not on a host of this provider/);

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError once the call timeout passes', async () => {
		// 1. A fetch that never answers until aborted; the per-call timeout overrides the location's
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					}),
			),
		);

		getAccessToken.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 });

		const driver = new PushDriverFcm({ serviceAccount: account, timeout: 60_000 });

		await expect(driver.call('GET /v1/x', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Cuts a token fetch that outlives the timeout, and fetches nothing once aborted', async () => {
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. A token that never comes is the call's deadline too; no request follows
		getAccessToken.mockReturnValueOnce(new Promise(() => {}));

		await expect(driver.call('GET /v1/x', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);

		expect(fetchSpy).not.toHaveBeenCalled();

		// 2. An already aborted signal stops the call before the token is asked for
		getAccessToken.mockClear();

		await expect(driver.call('GET /v1/x', {}, { signal: AbortSignal.abort(new Error('stop')) })).rejects.toThrow(
			'stop',
		);

		expect(getAccessToken).not.toHaveBeenCalled();
	});

	test('Reports a refused token without the SDK error, and honours paramsIn', async () => {
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		// 1. The SDK's error is not passed on as the cause
		const refused = Object.assign(new Error('invalid_grant'), { config: { data: 'assertion=secret-jwt' } });

		getAccessToken.mockRejectedValueOnce(refused);

		const error = (await driver.call('GET /v1/x').catch((thrown: unknown) => thrown)) as Error;

		expect(error.message).toBe('FCM: the access token could not be had: invalid_grant');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain('secret-jwt');

		// 2. A POST told to use the query sends no body
		getAccessToken.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 });
		fetchSpy.mockResolvedValueOnce(answer(200, {}));

		await driver.call('POST https://iid.googleapis.com/iid/v1:x', { a: 1 }, { paramsIn: 'query' });

		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

		expect(url).toBe('https://iid.googleapis.com/iid/v1:x?a=1');
		expect(init.body).toBeUndefined();
	});
});
