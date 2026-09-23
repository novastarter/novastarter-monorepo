/**
 * Tests of the Vonage driver class with the SDK's `SMS` client replaced; the message mapper and the error
 * description have their own tests in `to-vonage-message.test.ts` and `describe-error.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { MessageSendAllFailure } from '@vonage/sms';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { BALANCE_URL } from './constants.js';
import { SmsDriverVonage } from './driver.js';

const send = vi.fn();
const sendRequest = vi.fn();
const client = vi.fn();

// Only the client is replaced: `TypeEnum` of the mapper and the error classes of `describeError` stay the real ones
vi.mock('@vonage/sms', async (importOriginal) => {
	const original = await importOriginal<typeof import('@vonage/sms')>();

	/**
	 * Stand-in for the SDK's `SMS` client: exposes `send` and `sendRequest` as the shared spies and records how it was
	 * built.
	 */
	class SMS {
		/**
		 * The send API the driver calls, recorded so the tests can check the parameters it received.
		 */
		send = send;

		/**
		 * The raw request API `call()` goes through, recorded so the tests can check the request it received.
		 */
		sendRequest = sendRequest;

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

	test('Refuses an incomplete credential by the option name', () => {
		expect(() => new SmsDriverVonage({ apiKey: '', apiSecret: 'secret' })).toThrow(/"apiKey"/);
		expect(() => new SmsDriverVonage({ apiKey: 'key', apiSecret: '' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));

		vi.stubGlobal('fetch', fetch);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The credentials travel in an `Authorization` header and nothing is created or billed; they never go in
		//    the URL, which proxies, traces and error output record — the secret would leak into all of those
		await expect(driver.verify()).resolves.toBeUndefined();

		expect(fetch).toHaveBeenCalledWith(BALANCE_URL, {
			headers: { Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}` },
		});

		// 2. Bad credentials answer 401, which is reported with the status
		fetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
		await expect(driver.verify()).rejects.toThrow('Vonage: 401: Unauthorized');

		// 3. A network failure never reached the API and is described as it is
		fetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
		await expect(driver.verify()).rejects.toThrow('Vonage: ENOTFOUND');
	});

	test('Bounds the balance read with the configured timeout', async () => {
		const fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));

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
	/**
	 * An error the way the SDK's `sendRequest()` throws one for a non-2xx answer: a `VetchError` whose `config` holds
	 * the signed request and whose `response` is the unread answer.
	 *
	 * @param status - The HTTP status.
	 * @param body - The answer, sent as JSON.
	 * @param headers - Response headers.
	 * @returns The error.
	 */
	const vetchError = (status: number, body: unknown, headers: Record<string, string> = {}): Error =>
		Object.assign(new Error(`Request failed with status code ${status}`), {
			config: { headers: { Authorization: 'Basic a2V5OnNlY3JldA==' } },
			response: new Response(JSON.stringify(body), { status, headers }),
		});

	test('Sends a GET with the parameters in the URL and the location timeout', async () => {
		// 1. The SDK answers the decoded body; the query is built by the driver, a list repeating its key
		sendRequest.mockResolvedValueOnce({ status: 200, data: { value: 10.5, autoReload: false } });

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 5_000 });

		const result = await driver.call('GET /account/get-pricing/outbound/sms', { country: 'GB', x: ['a', 'b'] });

		expect(result).toStrictEqual({ value: 10.5, autoReload: false });

		expect(sendRequest).toHaveBeenCalledWith({
			method: 'GET',
			url: 'https://rest.nexmo.com/account/get-pricing/outbound/sms?country=GB&x=a&x=b',
			type: 'application/json',
			headers: {},
			timeout: 5_000,
		});
	});

	test('Sends a POST body to an API host, as a form when asked, with the caller headers and timeout', async () => {
		// 1. The caller's content type, normalized, becomes the SDK's `type`; the other headers go as given
		sendRequest.mockResolvedValueOnce({ status: 200, data: '' });

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
		expect(result).toBeUndefined();

		expect(sendRequest).toHaveBeenCalledWith({
			method: 'POST',
			url: 'https://api.nexmo.com/account/settings',
			type: 'application/x-www-form-urlencoded',
			headers: { 'x-trace': 't1' },
			timeout: 2_000,
			data: { drCallbackUrl: 'https://acme.test/dr' },
		});
	});

	test('Throws ProviderCallError for an error status and HitRateLimitError for 429, no secret in them', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The answer is read out of the SDK error; the error carries no cause, since the SDK's holds the signed
		//    request
		const refusal = { type: 'https://developer.vonage.com/api-errors#unauthorized', title: 'Unauthorized' };

		sendRequest.mockRejectedValueOnce(vetchError(401, refusal));

		const error = await driver.call('GET /account/get-balance').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'vonage', status: 401, body: refusal } });
		expect((error as Error).cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain('a2V5OnNlY3JldA==');
		expect((error as Error).message).not.toContain('secret');

		// 2. Too many requests is a rate limit the caller may wait out
		sendRequest.mockRejectedValueOnce(vetchError(429, { title: 'Throttled' }, { 'retry-after': '2' }));

		await expect(driver.call('GET /account/get-balance')).rejects.toBeInstanceOf(HitRateLimitError);

		// 3. What is not an answer — a network failure — passes through untouched
		const network = new TypeError('fetch failed');

		sendRequest.mockRejectedValueOnce(network);

		await expect(driver.call('GET /account/get-balance')).rejects.toBe(network);
	});

	test('Honours paramsIn and refuses a content type the SDK would send no body for', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. A POST told to use the query sends no body; a DELETE told to use the body sends one
		sendRequest.mockResolvedValueOnce({ status: 200, data: '' }).mockResolvedValueOnce({ status: 200, data: '' });

		await driver.call('POST /account/top-up', { trx: 't1' }, { paramsIn: 'query' });

		expect(sendRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({ url: 'https://rest.nexmo.com/account/top-up?trx=t1' }),
		);

		expect(sendRequest.mock.lastCall?.[0]).not.toHaveProperty('data');

		await driver.call('DELETE https://api.nexmo.com/x', { a: 1 }, { paramsIn: 'body' });

		expect(sendRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({ url: 'https://api.nexmo.com/x', data: { a: 1 } }),
		);

		// 2. Another content type is refused before anything is sent
		sendRequest.mockClear();

		await expect(driver.call('POST /x', { a: 1 }, { headers: { 'content-type': 'text/plain' } })).rejects.toThrow(
			/JSON or form/,
		);

		expect(sendRequest).not.toHaveBeenCalled();
	});

	test('Reports a 2xx answer the SDK could not decode as a plain error, not a ProviderCallError', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The SDK throws a `VetchError` when a JSON answer does not parse; it holds the signed request
		const undecodable = Object.assign(new Error('Failed to decode response body'), {
			config: { headers: { Authorization: 'Basic a2V5OnNlY3JldA==' } },
			response: new Response('{', { status: 200 }),
		});

		sendRequest.mockRejectedValueOnce(undecodable);

		const error = (await driver.call('GET /account/get-balance').catch((thrown: unknown) => thrown)) as Error;

		expect(error).not.toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('Vonage: the 200 answer to "GET /account/get-balance" could not be decoded');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain('a2V5OnNlY3JldA==');
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. An aborted signal fails the call with its reason before the SDK is reached
		await expect(
			driver.call('GET /account/get-balance', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(sendRequest).not.toHaveBeenCalled();
	});

	test('Refuses a foreign host before any request', async () => {
		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The key pair would go wherever the URL points, so only Vonage hosts are accepted
		await expect(driver.call('GET https://evil.example/account')).rejects.toThrow(/not on a host/);

		expect(sendRequest).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError when the SDK does not answer in time', async () => {
		// 1. A request that never settles is cut at the call timeout
		sendRequest.mockReturnValueOnce(new Promise(() => {}));

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.call('GET /account/get-balance', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});
});

describe('SmsDriverVonage.call with a file', () => {
	/** An upload URL on a Vonage host. */
	const UPLOAD_URL = 'https://api.nexmo.com/v1/uploads';

	test('Uploads as multipart without the SDK, with the key pair as Basic auth', async () => {
		// 1. `fetch` answers the upload; the SDK's client is not used for a file
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

		expect(result).toStrictEqual({ id: 'f1' });
		expect(sendRequest).not.toHaveBeenCalled();

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

		await expect(driver.call('POST /x', { files: [new Blob(['a']), new Blob(['b'])] })).resolves.toBeUndefined();

		const [url, init] = http.mock.calls[0]!;

		expect(url).toBe('https://rest.nexmo.com/x');
		expect((init.body as FormData).getAll('files')).toHaveLength(2);
	});

	test('Refuses a file in a query, and on a foreign host, before any request', async () => {
		const http = vi.fn();

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. A file has no place in a query, and the key pair would go wherever the URL points
		await expect(driver.call(`GET ${UPLOAD_URL}`, { file: new Blob(['x']) })).rejects.toThrow('body only');

		await expect(driver.call('POST https://evil.example/x', { file: new Blob(['x']) })).rejects.toThrow(
			/not on a host/,
		);

		expect(http).not.toHaveBeenCalled();
		expect(sendRequest).not.toHaveBeenCalled();
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
