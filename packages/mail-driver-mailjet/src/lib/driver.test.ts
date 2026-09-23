/**
 * Tests of the Mailjet driver class with the SDK mocked and `fetch` stubbed for `call()`; the message mapper is
 * covered in `to-mailjet-message.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverMailjet } from './driver.js';

/**
 * The stubbed `fetch` a `call()` goes through.
 *
 * @internal
 */
const fetchMock = vi.fn();

/**
 * Make `fetch` answer once with a JSON body.
 *
 * @param body - The body.
 * @param status - The HTTP status.
 * @param headers - The response headers.
 * @internal
 */
const answer = (body: unknown, status = 200, headers: Record<string, string> = {}): void => {
	// 1. A real `Response`, so the driver reads it the way it reads Mailjet's
	fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers }));
};

/**
 * The URL and the init of the n-th `fetch` call.
 *
 * @param index - Which call.
 * @returns The URL and the init.
 * @internal
 */
const fetched = (index = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } => {
	// 1. Read back from the stub, as `fetch(url, init)` was called
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }];

	return { url, init };
};

/**
 * Spy standing in for the request the SDK's `post().request()` chain makes, shared by every client so a test can
 * script Mailjet's answer.
 *
 * @internal
 */
const request = vi.fn();

/**
 * Spy standing in for the SDK client's `post()`, routed to the shared request spy.
 *
 * @internal
 */
const post = vi.fn(() => ({ request }));

/**
 * Spy receiving the options every SDK client is built with, so a test can assert what the driver passed.
 *
 * @internal
 */
const construct = vi.fn();

vi.mock('node-mailjet', () => ({
	/**
	 * Stand-in for the SDK's `Client`: records the constructor options and routes `post()` to the shared spy.
	 */
	Client: class {
		/**
		 * The shared `post` spy, so the test can assert the endpoint and API version the driver asked for.
		 *
		 * @internal
		 */
		post = post;

		/**
		 * Keep the options the driver built the client with.
		 *
		 * @param options - The key pair the driver passes to the SDK.
		 */
		constructor(public options: unknown) {
			// 1. Reported to the shared spy, since the driver keeps its client private
			construct(options);
		}
	},
}));

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('MailDriverMailjet', () => {
	test('Posts to send v3.1 and reads the per-recipient ids; a non-success status throws', async () => {
		// 1. A successful send answers the first recipient's message id
		request.mockResolvedValueOnce({
			body: { Messages: [{ Status: 'success', To: [{ Email: 'ada@example.com', MessageID: 123, MessageUUID: 'u' }] }] },
		});

		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's', sandbox: true });
		const message = { to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' };

		expect(await driver.send(message)).toStrictEqual({
			messageId: '123',
			accepted: ['ada@example.com'],
			rejected: [],
			response: 'success',
		});

		// 2. The request went to Send API v3.1 with the sandbox flag on the body
		expect(post).toHaveBeenCalledWith('send', { version: 'v3.1' });

		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ SandboxMode: true, Messages: [expect.objectContaining({ Subject: 'Hi' })] }),
		);

		// 3. A 200 with `Status: 'error'` is a failure; Mailjet's messages are listed
		request.mockResolvedValueOnce({
			body: { Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'Sender not validated' }] }] },
		});

		await expect(driver.send(message)).rejects.toThrow('Mailjet: Sender not validated');

		// 4. A transport failure names the provider, the SDK's error as the cause
		const failure = new Error('socket hang up');

		request.mockRejectedValueOnce(failure);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Mailjet: socket hang up',
			cause: failure,
		});

		// 5. A missing secret is refused by name
		expect(() => new MailDriverMailjet({ apiKey: 'k', apiSecret: '' })).toThrow(/"apiSecret"/);
		expect(defaultExport).toBe(MailDriverMailjet);
	});

	test('Builds the client with a timeout, 30 s unless the location sets one', () => {
		// 1. Without one the SDK would wait forever on a stalled connection, so the default is always passed
		new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		expect(construct).toHaveBeenLastCalledWith({ apiKey: 'k', apiSecret: 's', options: { timeout: 30_000 } });

		// 2. The location's own timeout replaces it
		new MailDriverMailjet({ apiKey: 'k', apiSecret: 's', timeout: 5_000 });

		expect(construct).toHaveBeenLastCalledWith({ apiKey: 'k', apiSecret: 's', options: { timeout: 5_000 } });
	});
});

describe('call', () => {
	/**
	 * The Basic auth header of the key pair `k:s`.
	 *
	 * @internal
	 */
	const basic = `Basic ${Buffer.from('k:s').toString('base64')}`;

	test('Sends a GET with the query and Basic auth on the key pair, and answers the parsed body', async () => {
		answer({ Count: 1, Data: [{ ID: 1 }], Total: 1 });

		// 1. The path goes under Mailjet's API root, the parameters into the query
		const { data } = await new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' }).call('GET /v3/REST/contact', {
			Limit: 10,
		});

		expect(data).toStrictEqual({ Count: 1, Data: [{ ID: 1 }], Total: 1 });
		expect(fetched().url).toBe('https://api.mailjet.com/v3/REST/contact?Limit=10');
		expect(fetched().init.method).toBe('GET');
		expect(fetched().init.headers['authorization']).toBe(basic);
		expect(fetched().init.body).toBeUndefined();
	});

	test('Sends a POST as a JSON body, with the caller headers on top and its own timeout', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		// 1. A full URL on Mailjet's own host is allowed; an empty answer is `undefined`
		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		await expect(
			driver.call('POST https://api.mailjet.com/v3.1/send', { Messages: [] }, { headers: { 'X-Trace': '1' } }),
		).resolves.toMatchObject({ status: 204, data: undefined });

		expect(fetched().url).toBe('https://api.mailjet.com/v3.1/send');
		expect(JSON.parse(fetched().init.body as string)).toStrictEqual({ Messages: [] });
		expect(fetched().init.headers).toMatchObject({ authorization: basic, 'x-trace': '1' });

		// 2. The caller's timeout replaces the default one
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /v3/REST/sender', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test("Takes the location's timeout when the call names none", async () => {
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		// 1. A stalled request fails after the location's timeout rather than the 30 s default
		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's', timeout: 10 });

		await expect(driver.call('GET /v3/REST/sender')).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Turns an error status into ProviderCallError without the key pair in the message', async () => {
		answer({ ErrorInfo: '', ErrorMessage: 'Object not found', StatusCode: 404 }, 404);

		// 1. The status and Mailjet's answer are kept; the message names Mailjet's reason
		const error = (await new MailDriverMailjet({ apiKey: 'KEY-ID', apiSecret: 'SECRET' })
			.call('GET /v3/REST/contact/1')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.extensions).toMatchObject({ provider: 'mailjet', method: 'GET /v3/REST/contact/1', status: 404 });
		expect(error.message).toBe('mailjet refused GET /v3/REST/contact/1: 404 Object not found');

		// 2. Neither key, nor the header built from them, reaches the message
		expect(error.message).not.toContain('SECRET');
		expect(error.message).not.toContain('KEY-ID');
		expect(error.message).not.toContain(Buffer.from('KEY-ID:SECRET').toString('base64'));
	});

	test('Turns a 429 into HitRateLimitError', async () => {
		answer({ ErrorMessage: 'Too many requests', StatusCode: 429 }, 429, { 'retry-after': '5' });

		// 1. The caller may try again later rather than treat it as a refusal
		await expect(
			new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' }).call('GET /v3/REST/contact'),
		).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a URL on a foreign host before any request', async () => {
		// 1. The key pair never leaves for another host; nothing is fetched
		await expect(
			new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' }).call('GET https://evil.example/v3/REST/contact'),
		).rejects.toThrow('not on a host of this provider');

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Accepts a full URL on the US region, which only a full URL reaches', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		// 1. The key pair goes to Mailjet's US API as it does to the default one
		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		await driver.call('GET https://api.us.mailjet.com/v3/REST/contact');

		expect(fetched().url).toBe('https://api.us.mailjet.com/v3/REST/contact');
	});
});

describe('MailDriverMailjet.call placeholders and answers', () => {
	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		// 1. A GET: the placeholder takes `id`, URL-encoded; the other parameters stay in the query
		await driver.call('GET /v3/REST/contact/{id}', { id: 'a/b', limit: 5 });
		expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.mailjet.com/v3/REST/contact/a%2Fb?limit=5');

		// 2. A POST: the placeholder's parameter is not in the body
		await driver.call('POST /v3/REST/contact/{id}/managecontactslists', { id: 42, name: 'welcome' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://api.mailjet.com/v3/REST/contact/42/managecontactslists');
		expect(init.body).toBe('{"name":"welcome"}');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		await expect(
			new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' }).call('GET /v3/REST/contact/{id}'),
		).rejects.toThrow(/"id" parameter/);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true}', { status: 201, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		// 1. Every call answers the whole response, headers named in lower case
		const answer = await driver.call('GET /v3/REST/contact/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});

describe('MailDriverMailjet.call big ids', () => {
	test('Answers a 64-bit message id as its exact digits, as send() reads it', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"Data":[{"ID":1152921504606847023,"Size":1.5}]}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);

		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's' });

		// 1. A plain `JSON.parse` would round the id to 1152921504606846976; a safe number stays a number
		const { data } = await driver.call('GET /v3/REST/message');

		expect(data).toStrictEqual({ Data: [{ ID: '1152921504606847023', Size: 1.5 }] });
	});
});
