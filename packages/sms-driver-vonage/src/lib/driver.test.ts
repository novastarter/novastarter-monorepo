/**
 * Tests of the Vonage driver class with the SDK's `SMS` client replaced; the message mapper and the error
 * description have their own tests in `to-vonage-message.test.ts` and `describe-error.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { MessageSendAllFailure, MessageSendPartialFailure } from '@vonage/sms';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, { SmsPartialDeliveryError } from '../index.js';
import { BALANCE_URL } from './constants.js';
import { SmsDriverVonage } from './driver.js';

const send = vi.fn();
const client = vi.fn();

// Only the client is replaced: `TypeEnum` of the mapper and the error classes of `describeError` stay the real ones
vi.mock('@vonage/sms', async (importOriginal) => {
	const original = await importOriginal<typeof import('@vonage/sms')>();

	/**
	 * Stand-in for the SDK's `SMS` client: exposes `send` as the shared spy and records how it was built.
	 */
	class SMS {
		/**
		 * The send API the driver calls, recorded so the tests can check the parameters it received.
		 */
		send = send;

		/**
		 * Take the credentials and the options the way the real client does.
		 *
		 * @param credentials - The key pair the driver passes.
		 * @param options - The client options the driver passes.
		 */
		constructor(credentials: unknown, options: unknown) {
			client(credentials, options);
		}
	}

	return { ...original, SMS };
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('SmsDriverVonage', () => {
	test('Sends and answers the id, the status, the part count and the balance', async () => {
		// 1. Vonage answers one entry per part of the message, each with the balance left after it
		send.mockResolvedValueOnce({
			messageCount: 2,
			messages: [
				{ to: '14155550123', messageId: 'm-1', status: '0', remainingBalance: '9.50' },
				{ to: '14155550123', messageId: 'm-2', status: '0', remainingBalance: '9.40' },
			],
		});

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 5_000 });

		expect(await driver.send({ to: '+14155550123', from: 'Acme', text: 'Hi' })).toStrictEqual({
			messageId: 'm-1',
			status: '0',
			segments: 2,
			response: 'balance 9.50',
		});

		expect(send).toHaveBeenCalledWith({ to: '14155550123', from: 'Acme', text: 'Hi', type: 'text' });
		expect(client).toHaveBeenCalledWith({ apiKey: 'key', apiSecret: 'secret' }, { timeout: 5_000 });
		expect(defaultExport).toBe(SmsDriverVonage);
	});

	test('Describes a refused message by Vonage status and wording', async () => {
		// 1. The SDK throws for an answer whose parts all failed; the status is what the application matches on
		send.mockRejectedValueOnce(
			new MessageSendAllFailure({
				messageCount: 1,
				messages: [{ status: '15', errorText: 'Illegal Sender Address - rejected' }],
			} as never),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.send({ to: '+14155550123', from: 'Acme', text: 'Hi' })).rejects.toThrow(
			'Vonage: 15: Illegal Sender Address - rejected',
		);
	});

	test('Reports a partially delivered message as the non-retryable SmsPartialDeliveryError', async () => {
		// 1. A long text becomes parts, one entry each in Vonage's answer; the SDK throws MessageSendPartialFailure
		//    when it took some parts and refused the rest — the accepted parts already went out and are billed, so the
		//    driver must not report this as a refusal a fallback would re-send
		send.mockRejectedValueOnce(
			new MessageSendPartialFailure({
				messageCount: 2,
				messages: [
					{ status: '0', messageId: 'm-1' },
					{ status: '9', errorText: 'Partner quota violation' },
				],
			} as never),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		const error = (await driver
			.send({ to: '+14155550123', from: 'Acme', text: 'Hi' })
			.catch((thrown: unknown) => thrown)) as Error;

		// 2. The dedicated error names how much went out and why the rest refused; the SDK's answer stays on the cause
		expect(error).toBeInstanceOf(SmsPartialDeliveryError);

		expect(error).toMatchObject({
			code: 'SMS_PARTIAL_DELIVERY',
			extensions: { delivered: 1, parts: 2, reason: '9: Partner quota violation' },
		});

		expect(error.cause).toBeInstanceOf(MessageSendPartialFailure);
	});

	test('Refuses an incomplete credential by the option name', () => {
		expect(() => new SmsDriverVonage({ apiKey: '', apiSecret: 'secret' })).toThrow(/"apiKey"/);
		expect(() => new SmsDriverVonage({ apiKey: 'key', apiSecret: '' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const fetch = vi.fn(async () => new Response('{"value":10.5,"autoReload":false}'));

		vi.stubGlobal('fetch', fetch);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The credentials travel in an `Authorization` header and nothing is created or billed; they never go in
		//    the URL, which proxies, traces and error output record — the secret would leak into all of those
		await expect(driver.verify()).resolves.toBeUndefined();

		expect(fetch).toHaveBeenCalledWith(BALANCE_URL, {
			headers: { Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}` },
		});

		// 2. Bad credentials answer 401, which is reported with the status
		fetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));
		await expect(driver.verify()).rejects.toThrow('Vonage: 401: Unauthorized');

		// 3. A network failure never reached the API and is described as it is
		fetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
		await expect(driver.verify()).rejects.toThrow('Vonage: ENOTFOUND');
	});

	test('Drains the balance response body, so the socket returns to the pool', async () => {
		// 1. The balance answer is not read further, but an unconsumed body would hold the socket out of `fetch`'s
		//    connection pool until GC — `verify()` consumes and drops it
		const response = new Response('{"value":10.5,"autoReload":false}');
		const drain = vi.spyOn(response, 'arrayBuffer');

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.verify()).resolves.toBeUndefined();

		expect(drain).toHaveBeenCalledTimes(1);
	});

	test('Bounds the balance read with the configured timeout', async () => {
		const fetch = vi.fn(async () => new Response('{"value":10.5,"autoReload":false}'));

		vi.stubGlobal('fetch', fetch);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 5_000 });

		await expect(driver.verify()).resolves.toBeUndefined();

		// 1. The timeout the SDK client was built with bounds this fetch too — a stalled balance read would otherwise
		//    sit out the agent's minutes-long limits
		expect(fetch).toHaveBeenCalledWith(BALANCE_URL, {
			headers: { Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}` },
			signal: expect.any(AbortSignal),
		});
	});
});

describe('SmsDriverVonage.call', () => {
	/** The Basic header of the key pair `key:secret`. */
	const BASIC = `Basic ${Buffer.from('key:secret').toString('base64')}`;

	/**
	 * Replace the global `fetch` with a spy answering the given responses in turn.
	 *
	 * @param responses - What each request is answered with.
	 * @returns The spy, for the tests to read the requests from.
	 */
	const stubFetch = (...responses: Response[]) => {
		// 1. One response per request, in order; `fetch` records the URL and the request of each
		const http = vi.fn(async (_url: string, _init: RequestInit) => responses.shift() ?? new Response(null));

		vi.stubGlobal('fetch', http);

		return http;
	};

	/**
	 * Read the headers of a recorded request.
	 *
	 * @param init - The request `fetch` received.
	 * @returns Its headers, as `httpCall` passes them: a record with lower-cased names.
	 */
	const headersOf = (init: RequestInit | undefined): Record<string, string> => {
		// 1. `httpCall` always hands a plain record
		return (init?.headers ?? {}) as Record<string, string>;
	};

	test('Sends a GET with the parameters in the URL and the key pair as Basic auth', async () => {
		// 1. The query is built from the parameters, a list repeating its key
		const http = stubFetch(Response.json({ value: 10.5, autoReload: false }));
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 5_000 });

		const { data } = await driver.call('GET /account/get-pricing/outbound/sms', { country: 'GB', x: ['a', 'b'] });

		expect(data).toStrictEqual({ value: 10.5, autoReload: false });

		// 2. The URL, the verb, the Basic header, no body, and a signal the deadline aborts
		const [url, init] = http.mock.calls[0]!;

		expect(url).toBe('https://rest.nexmo.com/account/get-pricing/outbound/sms?country=GB&x=a&x=b');
		expect(init.method).toBe('GET');
		expect(init.body).toBeUndefined();
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(init.redirect).toBe('manual');
		expect(headersOf(init)['authorization']).toBe(BASIC);
	});

	test('Sends a POST body as JSON by default', async () => {
		// 1. Without a content type the parameters go as JSON, `undefined` ones left out
		const http = stubFetch(Response.json({ ok: true }));
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		const { data } = await driver.call('POST https://api.nexmo.com/v1/items', { name: 'x', skip: undefined });

		expect(data).toStrictEqual({ ok: true });

		const [url, init] = http.mock.calls[0]!;

		expect(url).toBe('https://api.nexmo.com/v1/items');
		expect(headersOf(init)['content-type']).toBe('application/json');
		expect(init.body).toBe('{"name":"x"}');
	});

	test('Sends a form when the caller content type asks for one, with the caller headers', async () => {
		// 1. The caller's content type, in any case, makes it a form; the other headers go as given
		const http = stubFetch(new Response(null, { status: 204 }));
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		const result = await driver.call(
			'POST https://api.nexmo.com/account/settings',
			{ drCallbackUrl: 'https://acme.test/dr', skip: undefined },
			{
				timeout: 2_000,
				headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=utf-8', 'x-trace': 't1' },
			},
		);

		// 2. An empty answer is nothing
		expect(result).toStrictEqual({ status: 204, headers: {}, data: undefined });

		const [, init] = http.mock.calls[0]!;

		expect(init.body).toBe('drCallbackUrl=https%3A%2F%2Facme.test%2Fdr');
		expect(headersOf(init)['content-type']).toBe('Application/X-WWW-Form-Urlencoded; charset=utf-8');
		expect(headersOf(init)['x-trace']).toBe('t1');
		expect(headersOf(init)['authorization']).toBe(BASIC);
	});

	test('Throws ProviderCallError for an error status and HitRateLimitError for 429, no secret in them', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'super-secret' });
		const refusal = { type: 'https://developer.vonage.com/api-errors#unauthorized', title: 'Unauthorized' };

		// 1. Vonage's answer is kept as the body; the secret and the Basic header are nowhere in the error
		stubFetch(Response.json(refusal, { status: 401 }));

		const error = (await driver.call('GET /account/get-balance').catch((thrown: unknown) => thrown)) as Error;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'vonage', status: 401, body: refusal } });
		expect(error.cause).toBeUndefined();
		expect(error.message).not.toContain('super-secret');
		expect(JSON.stringify(error)).not.toContain('super-secret');
		expect(JSON.stringify(error)).not.toContain(Buffer.from('key:super-secret').toString('base64'));

		// 2. Too many requests is a rate limit the caller may wait out
		stubFetch(Response.json({ title: 'Throttled' }, { status: 429, headers: { 'retry-after': '2' } }));

		await expect(driver.call('GET /account/get-balance')).rejects.toBeInstanceOf(HitRateLimitError);

		// 3. What is not an answer — a network failure — passes through untouched; `fetch`'s error holds no header
		const network = new TypeError('fetch failed');

		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(network));

		await expect(driver.call('GET /account/get-balance')).rejects.toBe(network);
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const http = stubFetch();
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. An aborted signal fails the call with its reason before `fetch` is reached
		await expect(
			driver.call('GET /account/get-balance', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(http).not.toHaveBeenCalled();
	});

	test('Refuses a foreign host before any request', async () => {
		const http = stubFetch();
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The key pair would go wherever the URL points, so only Vonage hosts are accepted
		await expect(driver.call('GET https://evil.example/account')).rejects.toThrow(/not on a host/);

		expect(http).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError when Vonage does not answer in time', async () => {
		// 1. A request that never settles is cut at the call timeout
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.call('GET /account/get-balance', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Answers the status, the real lower-cased headers and the body', async () => {
		// 1. The response's own headers come back, their names lower-cased
		stubFetch(Response.json({ value: 10.5 }, { headers: { 'X-Request-Id': 'r1' } }));

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.call('GET /account/get-balance')).resolves.toStrictEqual({
			status: 200,
			headers: { 'content-type': 'application/json', 'x-request-id': 'r1' },
			data: { value: 10.5 },
		});
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		const http = stubFetch(new Response(null, { status: 204 }), new Response(null, { status: 204 }));
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. In a GET, the type leaves the query
		await driver.call('GET /account/get-pricing/outbound/{type}', { type: 'sms/x y', country: 'GB' });

		const [url] = http.mock.calls[0]!;

		expect(url).toBe('https://rest.nexmo.com/account/get-pricing/outbound/sms%2Fx%20y?country=GB');

		// 2. In a POST, it leaves the body
		await driver.call('POST https://api.nexmo.com/v1/items/{id}', { id: 'i1', name: 'x' });

		expect(http.mock.calls[1]![0]).toBe('https://api.nexmo.com/v1/items/i1');
		expect(http.mock.calls[1]![1].body).toBe('{"name":"x"}');
	});

	test('Refuses a {name} no parameter fills before any request', async () => {
		const http = stubFetch();
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. Sent, it would reach Vonage as `%7Btype%7D`
		await expect(driver.call('GET /account/get-pricing/outbound/{type}')).rejects.toThrow('{type}');
		expect(http).not.toHaveBeenCalled();
	});
});

describe('SmsDriverVonage.call with a file', () => {
	/** An upload URL on a Vonage host. */
	const UPLOAD_URL = 'https://api.nexmo.com/v1/uploads';

	test('Uploads as multipart, with the key pair as Basic auth', async () => {
		// 1. `fetch` answers the upload
		const http = vi.fn(
			async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'f1' }), { status: 201 }),
		);

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });
		const file = new File(['+447700900000'], 'numbers.csv', { type: 'text/csv' });

		const result = await driver.call(
			`POST ${UPLOAD_URL}`,
			{ name: 'batch', file, skip: undefined },
			{ headers: { 'content-type': 'application/json', 'x-trace': 't1' } },
		);

		expect(result.data).toStrictEqual({ id: 'f1' });

		// 2. The URL as given, Basic auth of the key pair, the caller's header, and the multipart body with the file —
		//    the caller's content type dropped for the multipart one
		const [url, init] = http.mock.calls[0]!;
		const headers = init.headers as Record<string, string>;
		const body = init.body as FormData;

		expect(url).toBe(UPLOAD_URL);
		expect(init.method).toBe('POST');
		expect(headers['authorization']).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
		expect(headers['x-trace']).toBe('t1');
		expect(headers).not.toHaveProperty('content-type');
		expect(body).toBeInstanceOf(FormData);
		expect(body.get('name')).toBe('batch');
		expect(body.has('skip')).toBe(false);
		expect((body.get('file') as File).name).toBe('numbers.csv');
		await expect((body.get('file') as File).text()).resolves.toBe('+447700900000');
	});

	test('Uploads a list of files to the default host for a path', async () => {
		// 1. A path goes under `rest.nexmo.com`; a list of files repeats its field
		const http = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.call('POST /x', { files: [new Blob(['a']), new Blob(['b'])] })).resolves.toMatchObject({
			status: 204,
		});

		const [url, init] = http.mock.calls[0]!;

		expect(url).toBe('https://rest.nexmo.com/x');
		expect((init.body as FormData).getAll('files')).toHaveLength(2);
	});

	test('Refuses an upload to a foreign host before any request', async () => {
		const http = vi.fn();

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The key pair would go wherever the URL points
		await expect(driver.call('POST https://evil.example/x', { file: new Blob(['x']) })).rejects.toThrow(
			/not on a host/,
		);

		expect(http).not.toHaveBeenCalled();
	});

	test('Throws ProviderCallError and HitRateLimitError for a refused upload, no secret in them', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'super-secret' });
		const refusal = { type: 'https://developer.vonage.com/api-errors#unauthorized', title: 'Unauthorized' };

		// 1. Vonage's answer is kept as the body; the secret and the Basic header are nowhere in the error
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(refusal), { status: 401 })),
		);

		const error = (await driver
			.call(`POST ${UPLOAD_URL}`, { file: new Blob(['x']) })
			.catch((thrown: unknown) => thrown)) as Error;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'vonage', status: 401, body: refusal } });
		expect(error.message).not.toContain('super-secret');
		expect(JSON.stringify(error)).not.toContain('super-secret');
		expect(JSON.stringify(error)).not.toContain(Buffer.from('key:super-secret').toString('base64'));
		expect(JSON.stringify(error.cause ?? null)).not.toContain('super-secret');

		// 2. Too many requests is a rate limit the caller may wait out
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } })),
		);

		await expect(driver.call(`POST ${UPLOAD_URL}`, { file: new Blob(['x']) })).rejects.toBeInstanceOf(
			HitRateLimitError,
		);
	});

	test('Fails an upload with TimeoutError at the location timeout', async () => {
		// 1. A `fetch` that never answers is cut at the location's timeout, the call naming none
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 10 });

		await expect(driver.call(`POST ${UPLOAD_URL}`, { file: new Blob(['x']) })).rejects.toBeInstanceOf(TimeoutError);
	});
});
