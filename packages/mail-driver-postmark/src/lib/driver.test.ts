/**
 * Tests of the Postmark driver class with the SDK mocked; the message mapping is tested in
 * `to-postmark-message.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { MailDriverPostmark } from './driver.js';

/**
 * Spy standing in for `ServerClient.sendEmail()`, shared by every instance so a test can script Postmark's answer and
 * inspect the request.
 *
 * @internal
 */
const sendEmail = vi.fn();

/**
 * Spy standing in for `ServerClient.getServer()`, the call `verify()` makes.
 *
 * @internal
 */
const getServer = vi.fn();

/**
 * Spy recording every `ServerClient` construction, so a test can check the token and configuration the driver built
 * the client with.
 *
 * @internal
 */
const construct = vi.fn();

vi.mock('postmark', () => ({
	/**
	 * Stand-in for the SDK's `ServerClient`: records its construction and routes the two calls the driver makes to
	 * the shared spies.
	 */
	ServerClient: class {
		/**
		 * Spy the driver's `send()` reaches.
		 *
		 * @internal
		 */
		sendEmail = sendEmail;

		/**
		 * Spy the driver's `verify()` reaches.
		 *
		 * @internal
		 */
		getServer = getServer;

		/**
		 * Record the token and configuration the driver builds the client with.
		 *
		 * @param args - Whatever the driver passes: the token and the optional configuration.
		 */
		constructor(...args: unknown[]) {
			construct(...args);
		}
	},
}));

/**
 * The stubbed `fetch` the raw calls go through.
 *
 * @internal
 */
const fetchMock = vi.fn();

/**
 * The URL and the init of the n-th `fetch` call.
 *
 * @param index - Which call.
 * @returns The URL and the init, headers as the record `httpCall()` builds.
 * @internal
 */
const sent = (index = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } => {
	// 1. Read back from the stub, as `fetch(url, init)` was called
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }];

	return { url, init };
};

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
	vi.clearAllMocks();
});

describe('MailDriverPostmark', () => {
	test('Requires the server token and is exported by name', () => {
		// 1. A missing token is refused by name
		expect(() => new MailDriverPostmark({ serverToken: '' })).toThrow('"serverToken"');
		expect(entry.MailDriverPostmark).toBe(MailDriverPostmark);
	});

	test('Builds the client with the token and the timeout', () => {
		// 1. Without a timeout the SDK gets no configuration at all
		new MailDriverPostmark({ serverToken: 'token' });

		expect(construct).toHaveBeenLastCalledWith('token', undefined);

		// 2. With one, only the timeout is set
		new MailDriverPostmark({ serverToken: 'token', timeout: 30 });

		expect(construct).toHaveBeenLastCalledWith('token', { timeout: 30 });
	});

	test('Sends and maps the result', async () => {
		// 1. Postmark answers one id and a message line per send
		sendEmail.mockResolvedValueOnce({
			To: 'ada@example.com',
			SubmittedAt: '2026-09-12T00:00:00Z',
			MessageID: 'b7bc2f4a-e38e-4336-ac7d-e6d5e1f9b2c1',
			ErrorCode: 0,
			Message: 'OK',
		});

		const driver = new MailDriverPostmark({ serverToken: 'token', messageStream: 'outbound' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
			tags: ['welcome'],
		});

		// 2. The location's stream and the first tag went out with the message
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ To: 'Ada <ada@example.com>', Tag: 'welcome', MessageStream: 'outbound' }),
		);

		// 3. Every recipient counts as accepted; the message line is the response
		expect(result).toStrictEqual({
			messageId: 'b7bc2f4a-e38e-4336-ac7d-e6d5e1f9b2c1',
			accepted: ['ada@example.com'],
			rejected: [],
			response: 'OK',
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// 1. The SDK's error is wrapped, not replaced: the cause keeps its code and status for the caller
		const refusal = Object.assign(new Error('Inactive recipient'), { code: 406, statusCode: 422 });

		sendEmail.mockRejectedValueOnce(refusal);

		const driver = new MailDriverPostmark({ serverToken: 'token' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: 'Postmark: Inactive recipient',
			cause: refusal,
		});
	});

	test('Surfaces a local mapping failure without the provider prefix', async () => {
		// 1. A message without a sender is refused by the mapper itself, before any request: the kit's own error
		//    stands alone, without the provider prefix the API refusal would get
		const driver = new MailDriverPostmark({ serverToken: 'token' });

		await expect(driver.send({ to: 'a@example.com', subject: 'S' })).rejects.toMatchObject({
			message: 'Postmark needs a "from" address',
		});

		// 2. The refusal happened before the API, so the client never sent anything
		expect(sendEmail).not.toHaveBeenCalled();
	});

	test('Verifies by reading the server', async () => {
		const driver = new MailDriverPostmark({ serverToken: 'token' });

		// 1. A server record means the token is good
		getServer.mockResolvedValueOnce({ ID: 1, Name: 'Production' });
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. A refusal passes with the provider's name, the SDK's error as the cause
		getServer.mockRejectedValueOnce(new Error('Bad token'));
		await expect(driver.verify()).rejects.toThrow('Postmark: Bad token');
	});
});

describe('MailDriverPostmark.call', () => {
	test('Sends a GET with the query and the server token, and a PUT with a JSON body', async () => {
		// 1. A GET carries its parameters in the query and answers the parsed JSON
		fetchMock.mockResolvedValueOnce(new Response('{"TotalCount":0,"Bounces":[]}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{"ID":1}', { status: 200 }));

		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token' });

		expect((await driver.call('GET /bounces', { count: 50, offset: 0 })).data).toStrictEqual({
			TotalCount: 0,
			Bounces: [],
		});

		expect(sent().url).toBe('https://api.postmarkapp.com/bounces?count=50&offset=0');
		expect(sent().init.method).toBe('GET');
		expect(sent().init.headers['x-postmark-server-token']).toBe('SECRET-token');
		expect(sent().init.headers['accept']).toBe('application/json');

		// 2. A PUT carries them in the body as JSON
		await driver.call('PUT /templates/1', { Name: 'Welcome' });

		expect(sent(1).url).toBe('https://api.postmarkapp.com/templates/1');
		expect(sent(1).init.body).toBe('{"Name":"Welcome"}');
		expect(sent(1).init.headers['content-type']).toBe('application/json');
	});

	test('Turns an error status into ProviderCallError without the token, and a 429 into HitRateLimitError', async () => {
		// 1. The provider's status and answer in the extensions; the token nowhere in the message
		const body = { ErrorCode: 10, Message: 'The Server Token you provided in the X-Postmark-Server-Token was invalid' };

		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 401 }));

		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token' });
		const error = await driver.call('GET /server').catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'postmark', method: 'GET /server', status: 401, body } });
		expect((error as Error).message).toContain('postmark refused GET /server: 401');
		expect((error as Error).message).not.toContain('SECRET');

		// 2. Too many requests is the rate-limit error
		fetchMock.mockResolvedValueOnce(new Response('{"ErrorCode":429}', { status: 429 }));

		await expect(driver.call('GET /server')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a full URL on another host before any request, and accepts one on api.postmarkapp.com', async () => {
		// 1. The token must not travel to someone else's host
		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token' });

		await expect(driver.call('GET https://api.postmarkapp.com.evil.example/bounces')).rejects.toThrow(
			/not on a host of this provider/,
		);

		expect(fetchMock).not.toHaveBeenCalled();

		// 2. Postmark's own host is fine
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		expect((await driver.call('DELETE https://api.postmarkapp.com/templates/1')).data).toBeUndefined();
		expect(sent().url).toBe('https://api.postmarkapp.com/templates/1');
	});

	test('Takes extra headers, and the location’s timeout unless the call names its own', async () => {
		// 1. The caller's headers go on top of the driver's
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token', timeout: 0.01 });

		await driver.call('GET /server', {}, { headers: { 'X-Trace': '1' } });
		expect(sent().init.headers['x-trace']).toBe('1');

		// 2. A request that only ends when its signal aborts gives up at the location's timeout, in seconds
		const hang = (_url: string, init: RequestInit): Promise<Response> =>
			new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

		fetchMock.mockImplementationOnce(hang);
		await expect(driver.call('GET /server')).rejects.toBeInstanceOf(TimeoutError);

		// 3. And at the call's own timeout over the default one
		fetchMock.mockImplementationOnce(hang);

		await expect(
			new MailDriverPostmark({ serverToken: 'SECRET-token' }).call('GET /server', {}, { timeout: 10 }),
		).rejects.toBeInstanceOf(TimeoutError);
	});
});

describe('MailDriverPostmark.call placeholders and answers', () => {
	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token' });

		// 1. A GET: the placeholder takes `id`, URL-encoded; the other parameters stay in the query
		await driver.call('GET /bounces/{id}', { id: 'a/b', limit: 5 });
		expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.postmarkapp.com/bounces/a%2Fb?limit=5');

		// 2. A POST: the placeholder's parameter is not in the body
		await driver.call('POST /templates/{id}/validate', { id: 42, name: 'welcome' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://api.postmarkapp.com/templates/42/validate');
		expect(init.body).toBe('{"name":"welcome"}');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		await expect(new MailDriverPostmark({ serverToken: 'SECRET-token' }).call('GET /bounces/{id}')).rejects.toThrow(
			/"id" parameter/,
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true}', { status: 201, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		const driver = new MailDriverPostmark({ serverToken: 'SECRET-token' });

		// 1. Every call answers the whole response, headers named in lower case
		const answer = await driver.call('GET /bounces/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});
