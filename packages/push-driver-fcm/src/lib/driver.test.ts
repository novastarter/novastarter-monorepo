/**
 * Tests of the FCM driver with the Firebase SDK mocked. The service account reading, the message mapping and the
 * error translation have their own tests next to `read-service-account.ts`, `to-fcm-message.ts` and
 * `describe-error.ts`.
 */
import { HitRateLimitError, InvalidConfigError, InvalidPayloadError, ProviderCallError } from '@novastarter/errors';
import { PushTargetGoneError } from '@novastarter/push';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PushDriverFcm as EntryExport } from '../index.js';
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

		// The app is named apart from the application's own
		expect(cert).toHaveBeenCalledWith({
			projectId: 'proj',
			clientEmail: 'sa@proj.iam.gserviceaccount.com',
			privateKey: 'LINE1\nLINE2',
		});

		expect(initializeApp).toHaveBeenCalledWith(
			{ credential: { getAccessToken }, projectId: 'proj' },
			expect.stringMatching(/^novastarter-push-/),
		);

		expect(driver.platforms).toStrictEqual(['fcm']);
		expect(() => new PushDriverFcm({ projectId: 'p', clientEmail: 'c' })).toThrow(/"serviceAccount"/);
		expect(() => new PushDriverFcm({ projectId: 'p', clientEmail: 'c' })).toThrow(InvalidConfigError);
	});

	test('Deletes the half-built Firebase app when the messaging client fails', () => {
		// `getMessaging()` throwing leaves the app in the SDK's global registry, holding live agents; the driver deletes
		// it, best-effort, before the error propagates
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

		expect(initializeApp).toHaveBeenCalledWith(
			{ credential: { getAccessToken }, projectId: 'proj' },
			expect.stringMatching(/^novastarter-push-/),
		);

		// FCM's message name is the id
		send.mockResolvedValueOnce('projects/proj/messages/1');
		expect(await driver.send(message)).toStrictEqual({ messageId: 'projects/proj/messages/1', status: 'accepted' });
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok', notification: { title: 'Hi' } }));

		// The two codes that mean the token is dead, and an `invalid-argument` about the token itself
		send.mockRejectedValueOnce(
			firebaseError('messaging/registration-token-not-registered', 'Requested entity was not found.'),
		);

		await expect(driver.send(message)).rejects.toBeInstanceOf(PushTargetGoneError);

		send.mockRejectedValueOnce(
			firebaseError('messaging/invalid-argument', 'The registration token is not a valid FCM registration token'),
		);

		await expect(driver.send(message)).rejects.toBeInstanceOf(PushTargetGoneError);

		const refused = firebaseError('messaging/invalid-argument', 'Invalid data payload key');

		send.mockRejectedValueOnce(refused);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'FCM messaging/invalid-argument: Invalid data payload key',
			cause: refused,
		});

		send.mockRejectedValueOnce(new Error('ECONNRESET'));
		await expect(driver.send(message)).rejects.toThrow('FCM: ECONNRESET');

		await expect(
			driver.send({ subscription: { endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow(/needs a token/);

		await expect(
			driver.send({ subscription: { endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } }, title: 'Hi' }),
		).rejects.toThrow(InvalidPayloadError);
	});

	test('Fails a send that outlives the timeout, and waits without one', async () => {
		// The SDK takes no timeout, so the driver races it: a request FCM never answers fails after the deadline, the
		// timeout as the cause; the request itself runs on, as the SDK call cannot be told to stop
		send.mockReturnValueOnce(new Promise(() => {}));

		const bounded = new PushDriverFcm({ serviceAccount: account, timeout: 20 });

		const failure: unknown = await bounded.send({ token: 'tok', title: 'Hi' }).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe('FCM: Timed out after 20 ms');
		expect((failure as Error).cause).toBeInstanceOf(TimeoutError);

		// An answer in time goes through unchanged, so the race costs a bounded send nothing
		send.mockResolvedValueOnce('projects/proj/messages/1');

		expect(await bounded.send({ token: 'tok', title: 'Hi' })).toStrictEqual({
			messageId: 'projects/proj/messages/1',
			status: 'accepted',
		});

		// Without a deadline the driver waits for the client, however long it takes
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

		// The token request is the proof
		getAccessToken.mockResolvedValueOnce({ access_token: 't', expires_in: 3600 });
		await expect(driver.verify()).resolves.toBeUndefined();

		getAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));
		await expect(driver.verify()).rejects.toThrow('FCM credentials are invalid: invalid_grant');

		await driver.close();

		expect(deleteApp).toHaveBeenCalledWith(
			expect.objectContaining({ name: expect.stringMatching(/^novastarter-push-/) }),
		);
	});

	test('Is exported by name from the entry point', () => {
		expect(EntryExport).toBe(PushDriverFcm);
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
		// `{projectId}` becomes the service account's project
		vi.stubGlobal('fetch', fetchSpy);
		getAccessToken.mockResolvedValueOnce({ access_token: 'ya29.secret', expires_in: 3600 });
		fetchSpy.mockResolvedValueOnce(answer(200, { name: 'projects/proj/messages/1' }));

		const driver = new PushDriverFcm({ serviceAccount: account });

		const method = 'POST /v1/projects/{projectId}/messages:send';
		const { data } = await driver.call(method, { message: { topic: 'news' } });

		expect(data).toStrictEqual({ name: 'projects/proj/messages/1' });

		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

		expect(url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send');
		expect(init.method).toBe('POST');
		expect(init.headers['authorization']).toBe('Bearer ya29.secret');
		expect(init.body).toBe(JSON.stringify({ message: { topic: 'news' } }));
	});

	test('Puts the parameters of a GET in the query and adds the caller headers', async () => {
		// A full URL on the Instance ID host is allowed; the caller's header joins the driver's
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

		// Google's error answer is kept with its status; the message names the reason, never the token
		const refusal = { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } };

		fetchSpy.mockResolvedValueOnce(answer(404, refusal));

		const error = await driver.call('GET /v1/projects/{projectId}/x').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'fcm', status: 404, body: refusal } });
		expect((error as Error).message).toContain('Requested entity was not found.');
		expect((error as Error).message).not.toContain('ya29.secret');

		// Too many requests is a rate limit the caller may wait out
		fetchSpy.mockResolvedValueOnce(answer(429, { error: { message: 'Quota exceeded' } }, { 'retry-after': '5' }));

		await expect(driver.call('GET /v1/projects/{projectId}/x')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a foreign host before fetching a token or making a request', async () => {
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		// The token would go wherever the URL points, so a foreign host is refused first
		await expect(driver.call('GET https://evil.example/steal')).rejects.toThrow(/not on a host of this provider/);

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError once the call timeout passes', async () => {
		// A fetch that never answers until aborted; the per-call timeout overrides the location's
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

		// A token that never comes is the call's deadline too; no request follows
		getAccessToken.mockReturnValueOnce(new Promise(() => {}));

		await expect(driver.call('GET /v1/x', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);

		expect(fetchSpy).not.toHaveBeenCalled();

		// An already aborted signal stops the call before the token is asked for
		getAccessToken.mockClear();

		await expect(driver.call('GET /v1/x', {}, { signal: AbortSignal.abort(new Error('stop')) })).rejects.toThrow(
			'stop',
		);

		expect(getAccessToken).not.toHaveBeenCalled();
	});

	test('Reports a refused token without the SDK error', async () => {
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		// The SDK's error is not passed on as the cause, as it carries the signed request
		const refused = Object.assign(new Error('invalid_grant'), { config: { data: 'assertion=secret-jwt' } });

		getAccessToken.mockRejectedValueOnce(refused);

		const error = (await driver.call('GET /v1/x').catch((thrown: unknown) => thrown)) as Error;

		expect(error.message).toBe('fcm: the credentials for the call could not be had (Error)');
		expect(error.message).not.toContain('invalid_grant');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain('secret-jwt');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		// Google's request id readable under its lower-case name
		vi.stubGlobal('fetch', fetchSpy);
		getAccessToken.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 });
		fetchSpy.mockResolvedValueOnce(answer(200, { name: 'n1' }, { 'X-Goog-Request-Id': 'g1' }));

		const driver = new PushDriverFcm({ serviceAccount: account });

		const method = 'POST /v1/projects/{projectId}/messages:send';

		await expect(driver.call(method, { message: {} })).resolves.toStrictEqual({
			status: 200,
			headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-goog-request-id': 'g1' },
			data: { name: 'n1' },
		});
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		// In a GET, the token leaves the query
		vi.stubGlobal('fetch', fetchSpy);

		getAccessToken
			.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 })
			.mockResolvedValueOnce({ access_token: 'tok', expires_in: 3600 });

		fetchSpy.mockResolvedValueOnce(answer(200, {}));
		fetchSpy.mockResolvedValueOnce(answer(200, {}));

		const driver = new PushDriverFcm({ serviceAccount: account });

		await driver.call('GET https://iid.googleapis.com/iid/info/{token}', { token: 'a:b/c', details: true });

		expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://iid.googleapis.com/iid/info/a%3Ab%2Fc?details=true');

		// In a POST, it leaves the body; `{projectId}` is still the location's
		await driver.call('POST /v1/projects/{projectId}/messages/{id}:x', { id: 'm1', flag: true });

		const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages/m1:x');
		expect(init.body).toBe(JSON.stringify({ flag: true }));
	});

	test('Refuses a {name} no parameter fills before fetching a token or making a request', async () => {
		// Sent, it would reach Google as `%7Btoken%7D`
		vi.stubGlobal('fetch', fetchSpy);

		const driver = new PushDriverFcm({ serviceAccount: account });

		await expect(driver.call('GET https://iid.googleapis.com/iid/info/{token}')).rejects.toThrow('{token}');
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
