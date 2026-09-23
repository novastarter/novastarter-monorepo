/**
 * Tests of the Twilio driver class with the SDK mocked; the message mapper and the error description have their own
 * tests in `to-twilio-message.test.ts` and `describe-error.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { SmsDriverTwilio } from './driver.js';

const create = vi.fn();
const fetch = vi.fn();
const destroy = vi.fn();
const request = vi.fn();

/**
 * The request client the SDK hangs off the client, as the driver reaches it; a test can strip the axios shape to
 * mimic a custom client that has no agent to release.
 */
const httpClient: { axios?: { defaults: { httpsAgent: { destroy: () => void } } } | undefined } = {
	axios: { defaults: { httpsAgent: { destroy } } },
};

vi.mock('twilio', () => {
	/**
	 * Stand-in for the SDK's `RestException`, so `describeError` recognises a refused request in these tests too.
	 */
	class RestException extends Error {
		/** HTTP status Twilio answered with. */
		status = 400;
		/** Twilio's own error code. */
		code = 21211;
	}

	/**
	 * Stand-in for the `twilio()` factory: hands out a client whose messages and balance APIs and raw `request()` are
	 * the shared spies, so each test can script Twilio's answer and inspect the request.
	 */
	const factory = vi.fn(() => ({
		messages: { create },
		balance: { fetch },
		request,
		httpClient,
	}));

	return { default: Object.assign(factory, { RestException }) };
});

afterEach(() => {
	vi.clearAllMocks();
	httpClient.axios = { defaults: { httpsAgent: { destroy } } };
	vi.unstubAllGlobals();
});

describe('SmsDriverTwilio', () => {
	test('Sends and answers the SID, the status and the segment count', async () => {
		// 1. A successful send answers what Twilio queued the message as
		create.mockResolvedValueOnce({ sid: 'SM1', status: 'queued', numSegments: '2', errorCode: null });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(await driver.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toStrictEqual({
			messageId: 'SM1',
			status: 'queued',
			segments: 2,
		});

		expect(create).toHaveBeenCalledWith({ to: '+14155550123', body: 'Hi', from: '+14155550100' });
		expect(defaultExport).toBe(SmsDriverTwilio);
	});

	test('Reports no segment count when Twilio does not say one', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. `null` and an empty string are not counts — reporting 0 would claim the text was split into zero parts,
		//    so the result carries no `segments` key at all
		create.mockResolvedValueOnce({ sid: 'SM4', status: 'queued', numSegments: null, errorCode: null });

		expect(await driver.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toStrictEqual({
			messageId: 'SM4',
			status: 'queued',
		});

		create.mockResolvedValueOnce({ sid: 'SM5', status: 'queued', numSegments: '', errorCode: null });

		expect(await driver.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toStrictEqual({
			messageId: 'SM5',
			status: 'queued',
		});
	});

	test('Adds the location messaging service and status callback to a message without a sender', async () => {
		create.mockResolvedValueOnce({ sid: 'SM2', status: 'accepted', numSegments: '1' });

		const driver = new SmsDriverTwilio({
			accountSid: 'AC1',
			authToken: 'token',
			messagingServiceSid: 'MG1',
			statusCallback: 'https://acme.test/hook',
		});

		await driver.send({ to: '+14155550123', text: 'Hi', ttl: 600 });

		// 1. The pool of the messaging service supplies the sender, and the validity period is the message's `ttl`
		expect(create).toHaveBeenCalledWith({
			to: '+14155550123',
			body: 'Hi',
			messagingServiceSid: 'MG1',
			validityPeriod: 600,
			statusCallback: 'https://acme.test/hook',
		});
	});

	test('Throws on a refusal and on a message Twilio accepted but already failed', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });
		const message = { to: '+14155550123', from: '+14155550100', text: 'Hi' };

		// 1. A rejected request is described by its status and Twilio's own code, the SDK error kept as the cause
		const refusal = new Error('The "To" number is not a valid phone number.');

		create.mockRejectedValueOnce(refusal);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Twilio: The "To" number is not a valid phone number.',
			cause: refusal,
		});

		// 2. An answer carrying an error code is a failure too, however accepted it looks: the caller must not record
		//    it as sent
		create.mockResolvedValueOnce({
			sid: 'SM3',
			status: 'failed',
			numSegments: '1',
			errorCode: 21610,
			errorMessage: 'Unsubscribed recipient',
		});

		await expect(driver.send(message)).rejects.toThrow('Twilio: 21610: Unsubscribed recipient');
	});

	test('Authenticates with an API key pair when one is given, and refuses half a configuration', async () => {
		const twilio = (await import('twilio')).default;

		// 1. A key pair signs for the account named in the options
		new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1', apiSecret: 'secret', timeout: 5_000 });

		expect(twilio).toHaveBeenCalledWith('SK1', 'secret', { timeout: 5_000, accountSid: 'AC1' });

		// 2. Without a key pair the account's auth token is the credential
		new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(twilio).toHaveBeenLastCalledWith('AC1', 'token', {});

		// 3. Missing or incomplete credentials are refused by the option's name
		expect(() => new SmsDriverTwilio({ accountSid: '', authToken: 'token' })).toThrow(/"accountSid"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1' })).toThrow(/"authToken"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. Nothing is sent and nothing is billed; the read either authenticates or throws
		fetch.mockResolvedValueOnce({ balance: '10.00', currency: 'USD' });
		await expect(driver.verify()).resolves.toBeUndefined();

		fetch.mockRejectedValueOnce(new Error('Authenticate'));
		await expect(driver.verify()).rejects.toThrow('Twilio: Authenticate');
	});

	test('Releases the keep-alive agent on close', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. The SDK pools connections in a keep-alive https.Agent and has no close of its own, so `close()` destroys
		//    the agent behind its axios instance
		await driver.close();

		expect(destroy).toHaveBeenCalledTimes(1);
	});

	test('Closes cleanly when the client has no axios agent', async () => {
		// 1. A custom or mocked request client may carry no axios defaults at all: there is nothing to release, and
		//    `close()` must not throw — the manager awaits it while releasing every location
		httpClient.axios = undefined;

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(driver.close()).resolves.toBeUndefined();
		expect(destroy).not.toHaveBeenCalled();
	});
});

describe('SmsDriverTwilio.call', () => {
	test('Sends a GET through the SDK with the query, the account filled in and the location timeout', async () => {
		// 1. The SDK answers the body already parsed, whatever the status
		request.mockResolvedValueOnce({ statusCode: 200, body: { sid: 'SM1', status: 'delivered' }, headers: {} });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token', timeout: 5_000 });

		const result = await driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages.json', {
			To: '+14155550123',
			PageSize: undefined,
		});

		expect(result).toStrictEqual({ sid: 'SM1', status: 'delivered' });

		expect(request).toHaveBeenCalledWith({
			method: 'get',
			uri: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json',
			params: { To: '+14155550123' },
			headers: {},
			timeout: 5_000,
		});
	});

	test('Sends a POST body to a Twilio subdomain with the caller headers and timeout, JSON text parsed', async () => {
		// 1. A body arriving as JSON text is parsed; a caller's content type is normalized to the SDK's spelling
		request.mockResolvedValueOnce({ statusCode: 201, body: '{"sid":"VE1"}', headers: {} });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		const result = await driver.call(
			'POST https://verify.twilio.com/v2/Services/VA1/Verifications',
			{ To: '+14155550123', Channel: 'sms' },
			{
				timeout: 2_000,
				headers: { 'content-type': ' Application/JSON; charset=utf-8', 'X-Twilio-Idempotency': 'k1' },
			},
		);

		expect(result).toStrictEqual({ sid: 'VE1' });

		expect(request).toHaveBeenCalledWith({
			method: 'post',
			uri: 'https://verify.twilio.com/v2/Services/VA1/Verifications',
			data: { To: '+14155550123', Channel: 'sms' },
			headers: { 'X-Twilio-Idempotency': 'k1', 'Content-Type': 'application/json' },
			timeout: 2_000,
		});

		// 2. An empty answer — a 204 of a DELETE — is nothing
		request.mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} });

		expect(await driver.call('DELETE /2010-04-01/Accounts/{AccountSid}/Messages/SM1.json')).toBeUndefined();
	});

	test('Throws ProviderCallError with Twilio error body and HitRateLimitError for 429, no secret in them', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'super-secret-token' });

		// 1. Twilio's error JSON is kept as the body, its message quoted, the auth token nowhere
		const refusal = {
			code: 20404,
			message: 'The requested resource was not found',
			more_info: 'https://www.twilio.com/docs/errors/20404',
			status: 404,
		};

		request.mockResolvedValueOnce({ statusCode: 404, body: refusal, headers: {} });

		const error = await driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages/SM9.json').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'twilio', status: 404, body: refusal } });
		expect((error as Error).message).toContain('The requested resource was not found');
		expect((error as Error).message).not.toContain('super-secret-token');

		// 2. Too many requests is a rate limit the caller may wait out
		request.mockResolvedValueOnce({ statusCode: 429, body: { code: 20429 }, headers: { 'retry-after': '3' } });

		await expect(driver.call('GET /2010-04-01/Accounts.json')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a foreign host before any request', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. The credentials would go wherever the URL points, so only Twilio hosts are accepted
		await expect(driver.call('GET https://twilio.com.evil.example/x')).rejects.toThrow(/not on a host/);
		await expect(driver.call('FETCH /x')).rejects.toThrow(/is not/);

		expect(request).not.toHaveBeenCalled();
	});

	test('Sends a body of any verb as a form unless JSON is asked, and refuses other content types', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. The SDK sets a form type for a POST only and fills the body only for an exact type, so a PUT gets one too
		request.mockResolvedValueOnce({ statusCode: 200, body: {}, headers: {} });

		await driver.call('PUT https://conversations.twilio.com/v1/Conversations/CH1', { FriendlyName: 'x' });

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: { FriendlyName: 'x' },
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			}),
		);

		// 2. A DELETE told to carry a body gets the form type as well
		request.mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} });

		await driver.call('DELETE /2010-04-01/Accounts/{AccountSid}/Keys/SK1.json', { A: 1 }, { paramsIn: 'body' });

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: { A: 1 },
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			}),
		);

		// 3. A POST told to use the query sends no body
		request.mockResolvedValueOnce({ statusCode: 200, body: {}, headers: {} });

		await driver.call('POST /2010-04-01/Accounts/{AccountSid}/Calls/CA1.json', { B: 2 }, { paramsIn: 'query' });

		expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ params: { B: 2 }, headers: {} }));
		expect(request.mock.lastCall?.[0]).not.toHaveProperty('data');

		// 4. A type the SDK would silently send no body for is refused before anything is sent
		request.mockClear();

		await expect(driver.call('POST /x', { C: 3 }, { headers: { 'Content-Type': 'text/plain' } })).rejects.toThrow(
			/form or JSON/,
		);

		expect(request).not.toHaveBeenCalled();
	});

	test('Rethrows a network failure without the SDK error and its credentials', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'super-secret-token' });
		const authorization = `Basic ${Buffer.from('AC1:super-secret-token').toString('base64')}`;

		// 1. An axios error of the SDK holds the request config with the `Authorization` header
		const axiosError = Object.assign(new Error('timeout of 30000ms exceeded'), {
			isAxiosError: true,
			code: 'ECONNABORTED',
			config: { headers: { Authorization: authorization } },
		});

		request.mockRejectedValueOnce(axiosError);

		const error = (await driver.call('GET /2010-04-01/Accounts.json').catch((e: unknown) => e)) as Error;

		// 2. A plain error names the code; neither it, its cause nor its serialization carries the credentials
		expect(error.message).toBe('Twilio: ECONNABORTED: timeout of 30000ms exceeded');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain(authorization);
		expect(error.message).not.toContain('super-secret-token');

		// 3. The same failure of `send()` is described without it too
		create.mockRejectedValueOnce(axiosError);

		const sendError = (await driver
			.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })
			.catch((e: unknown) => e)) as Error;

		expect(sendError.cause).toBeUndefined();
		expect(JSON.stringify(sendError)).not.toContain(authorization);
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. An aborted signal fails the call with its reason before the SDK is reached
		await expect(
			driver.call('GET /2010-04-01/Accounts.json', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(request).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError when the SDK does not answer in time', async () => {
		// 1. A request that never settles is cut at the call timeout
		request.mockReturnValueOnce(new Promise(() => {}));

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(driver.call('GET /2010-04-01/Accounts.json', {}, { timeout: 10 })).rejects.toBeInstanceOf(
			TimeoutError,
		);
	});
});

describe('SmsDriverTwilio.call with a file', () => {
	/** The URL of a Serverless asset version, where Twilio takes uploads. */
	const ASSET_URL = 'https://serverless-upload.twilio.com/v1/Services/ZS1/Assets/ZH1/Versions';

	test('Uploads as multipart without the SDK, with the account credentials as Basic auth', async () => {
		// 1. `fetch` answers Twilio's asset version; the SDK's client is not used for a file
		const http = vi.fn(
			async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ sid: 'ZN1' }), { status: 201 }),
		);

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token', timeout: 5_000 });
		const content = new File(['png'], 'logo.png', { type: 'image/png' });

		const result = await driver.call(
			`POST ${ASSET_URL}`,
			{ Path: '/logo.png', Visibility: 'public', Content: content },
			{ headers: { 'Content-Type': 'application/json', 'X-Trace': 't1' } },
		);

		expect(result).toStrictEqual({ sid: 'ZN1' });
		expect(request).not.toHaveBeenCalled();

		// 2. The URL as given, Basic auth of the SID and token, the caller's header, and the multipart body with the
		//    file — the caller's content type dropped for the multipart one
		const [url, init] = http.mock.calls[0]!;
		const headers = init.headers as Record<string, string>;
		const body = init.body as FormData;

		expect(url).toBe(ASSET_URL);
		expect(init.method).toBe('POST');
		expect(headers['authorization']).toBe(`Basic ${Buffer.from('AC1:token').toString('base64')}`);
		expect(headers['x-trace']).toBe('t1');
		expect(headers).not.toHaveProperty('content-type');
		expect(body).toBeInstanceOf(FormData);
		expect(body.get('Path')).toBe('/logo.png');
		expect((body.get('Content') as File).name).toBe('logo.png');
		await expect((body.get('Content') as File).text()).resolves.toBe('png');
	});

	test('Signs an upload with the API key pair when the location has one, a list of files included', async () => {
		// 1. The key pair is what the client signs with, so the upload uses it too
		const http = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1', apiSecret: 'shh' });

		await expect(driver.call(`POST ${ASSET_URL}`, { Content: [new Blob(['a']), new Blob(['b'])] })).resolves.toBe(
			undefined,
		);

		const [, init] = http.mock.calls[0]!;

		expect((init.headers as Record<string, string>)['authorization']).toBe(
			`Basic ${Buffer.from('SK1:shh').toString('base64')}`,
		);

		expect((init.body as FormData).getAll('Content')).toHaveLength(2);
	});

	test('Refuses a file in a query, and on a foreign host, before any request', async () => {
		const http = vi.fn();

		vi.stubGlobal('fetch', http);

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. A file has no place in a query, and the credentials would go wherever the URL points
		await expect(driver.call(`GET ${ASSET_URL}`, { Content: new Blob(['x']) })).rejects.toThrow('body only');

		await expect(driver.call('POST https://evil.example/x', { Content: new Blob(['x']) })).rejects.toThrow(
			/not on a host/,
		);

		expect(http).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
	});

	test('Throws ProviderCallError and HitRateLimitError for a refused upload, no secret in them', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'super-secret-token' });
		const refusal = { code: 20001, message: 'Invalid Path', more_info: 'https://www.twilio.com/docs/errors/20001' };

		// 1. Twilio's error JSON is kept as the body; the auth token is nowhere in the error
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 })),
		);

		const error = (await driver
			.call(`POST ${ASSET_URL}`, { Content: new Blob(['x']) })
			.catch((thrown: unknown) => thrown)) as Error;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'twilio', status: 400, body: refusal } });
		expect(error.message).not.toContain('super-secret-token');
		expect(JSON.stringify(error)).not.toContain('super-secret-token');
		expect(JSON.stringify(error)).not.toContain(Buffer.from('AC1:super-secret-token').toString('base64'));
		expect(JSON.stringify(error.cause ?? null)).not.toContain('super-secret-token');

		// 2. Too many requests is a rate limit the caller may wait out
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } })),
		);

		await expect(driver.call(`POST ${ASSET_URL}`, { Content: new Blob(['x']) })).rejects.toBeInstanceOf(
			HitRateLimitError,
		);
	});

	test('Fails an upload with TimeoutError when Twilio does not answer in time', async () => {
		// 1. A `fetch` that never answers is cut at the call's timeout
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(
			driver.call(`POST ${ASSET_URL}`, { Content: new Blob(['x']) }, { timeout: 10 }),
		).rejects.toBeInstanceOf(TimeoutError);
	});
});
