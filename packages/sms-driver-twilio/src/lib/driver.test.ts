/**
 * Tests of the Twilio driver class with the SDK mocked; the message mapper and the error description have their own
 * tests in `to-twilio-message.test.ts` and `describe-error.test.ts`.
 */
import { HitRateLimitError, InvalidConfigError, InvalidPayloadError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
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
		create.mockResolvedValueOnce({ sid: 'SM1', status: 'queued', numSegments: '2', errorCode: null });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(await driver.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toStrictEqual({
			messageId: 'SM1',
			status: 'queued',
			segments: 2,
		});

		expect(create).toHaveBeenCalledWith({ to: '+14155550123', body: 'Hi', from: '+14155550100' });
		expect(entry.SmsDriverTwilio).toBe(SmsDriverTwilio);
		expect(entry).not.toHaveProperty('default');
	});

	test('Reports no segment count when Twilio does not say one', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// Reporting 0 would claim the text was split into zero parts, so the result carries no `segments` key at all.
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

		const refusal = new Error('The "To" number is not a valid phone number.');

		create.mockRejectedValueOnce(refusal);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Twilio: The "To" number is not a valid phone number.',
			cause: refusal,
		});

		// An answer carrying an error code is a failure however accepted it looks: the caller must not record it as
		// sent.
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

		new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1', apiSecret: 'secret', timeout: 5_000 });

		expect(twilio).toHaveBeenCalledWith('SK1', 'secret', { timeout: 5_000, accountSid: 'AC1' });

		new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(twilio).toHaveBeenLastCalledWith('AC1', 'token', {});

		expect(() => new SmsDriverTwilio({ accountSid: '', authToken: 'token' })).toThrow(InvalidConfigError);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1' })).toThrow(InvalidConfigError);
		expect(() => new SmsDriverTwilio({ accountSid: '', authToken: 'token' })).toThrow(/"accountSid"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1' })).toThrow(/"authToken"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// Nothing is sent and nothing is billed.
		fetch.mockResolvedValueOnce({ balance: '10.00', currency: 'USD' });
		await expect(driver.verify()).resolves.toBeUndefined();

		fetch.mockRejectedValueOnce(new Error('Authenticate'));
		await expect(driver.verify()).rejects.toThrow('Twilio: Authenticate');
	});

	test('Releases the keep-alive agent on close', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// The SDK pools connections in a keep-alive https.Agent and has no close of its own, so `close()` destroys the
		// agent behind its axios instance.
		await driver.close();

		expect(destroy).toHaveBeenCalledTimes(1);
	});

	test('Closes cleanly when the client has no axios agent', async () => {
		// A custom or mocked request client may carry no axios defaults at all; `close()` must not throw, since the
		// manager awaits it while releasing every location.
		httpClient.axios = undefined;

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(driver.close()).resolves.toBeUndefined();
		expect(destroy).not.toHaveBeenCalled();
	});
});

describe('SmsDriverTwilio.call', () => {
	test('Exposes the SDK client it signs with', () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(driver.client.request).toBe(request);
	});

	test('Sends a GET through the SDK with the query, the account filled in and the location timeout', async () => {
		request.mockResolvedValueOnce({ statusCode: 200, body: { sid: 'SM1', status: 'delivered' }, headers: {} });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token', timeout: 5_000 });

		const result = await driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages.json', {
			To: '+14155550123',
			PageSize: undefined,
		});

		expect(result.data).toStrictEqual({ sid: 'SM1', status: 'delivered' });

		expect(request).toHaveBeenCalledWith({
			method: 'get',
			uri: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json',
			params: { To: '+14155550123' },
			headers: {},
			timeout: 5_000,
		});
	});

	test('Sends a POST body to a Twilio subdomain with the caller headers and timeout, JSON text parsed', async () => {
		request.mockResolvedValueOnce({ statusCode: 201, body: '{"sid":"VE1"}', headers: {} });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		const result = await driver.call(
			'POST https://verify.twilio.com/v2/Services/VA1/Verifications',
			{ To: '+14155550123', Channel: 'sms' },
			{
				timeout: 2_000,
				headers: { 'Content-Type': 'application/json', 'X-Twilio-Idempotency': 'k1' },
			},
		);

		expect(result).toStrictEqual({ status: 201, headers: {}, data: { sid: 'VE1' } });

		expect(request).toHaveBeenCalledWith({
			method: 'post',
			uri: 'https://verify.twilio.com/v2/Services/VA1/Verifications',
			data: { To: '+14155550123', Channel: 'sms' },
			headers: { 'X-Twilio-Idempotency': 'k1', 'Content-Type': 'application/json' },
			timeout: 2_000,
		});

		request.mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} });

		expect((await driver.call('DELETE /2010-04-01/Accounts/{AccountSid}/Messages/SM1.json')).data).toBeUndefined();
	});

	test('Throws ProviderCallError with Twilio error body and HitRateLimitError for 429, no secret in them', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'super-secret-token' });

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

		request.mockResolvedValueOnce({ statusCode: 429, body: { code: 20429 }, headers: { 'retry-after': '3' } });

		await expect(driver.call('GET /2010-04-01/Accounts.json')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a foreign host before any request', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// The credentials would go wherever the URL points, so only Twilio hosts are accepted.
		await expect(driver.call('GET https://twilio.com.evil.example/x')).rejects.toThrow(/not on a host/);
		await expect(driver.call('FETCH /x')).rejects.toThrow(/is not/);

		expect(request).not.toHaveBeenCalled();
	});

	test('Sends the body of any verb but GET, HEAD and DELETE as a form', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// The SDK sets a form type for a POST only and fills the body only for an exact type, so a PUT gets one too.
		request.mockResolvedValueOnce({ statusCode: 200, body: {}, headers: {} });

		await driver.call('PUT https://conversations.twilio.com/v1/Conversations/CH1', { FriendlyName: 'x' });

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: { FriendlyName: 'x' },
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			}),
		);
	});

	test('Reads a content type in any case, so a lower-case JSON one sends JSON', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		request.mockResolvedValueOnce({ statusCode: 201, body: {}, headers: {} });

		await driver.call(
			'POST https://verify.twilio.com/v2/Services/VA1/Verifications',
			{ To: '+14155550123' },
			{ headers: { 'content-type': 'Application/JSON; charset=utf-8', 'X-Trace': '1' } },
		);

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: { To: '+14155550123' },
				headers: { 'X-Trace': '1', 'Content-Type': 'application/json' },
			}),
		);

		request.mockClear();

		const refused = driver.call('POST /x', { a: 1 }, { headers: { 'content-type': 'text/plain' } });

		await expect(refused).rejects.toThrow(InvalidPayloadError);
		await expect(refused).rejects.toThrow('form or JSON only');

		expect(request).not.toHaveBeenCalled();
	});

	test('Refuses a file before any request', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// The SDK's client makes no multipart body; an upload goes through the SDK client itself.
		await expect(driver.call('POST /x', { Content: new Blob(['x']) })).rejects.toThrow(InvalidPayloadError);
		await expect(driver.call('POST /x', { Content: new Blob(['x']) })).rejects.toThrow('sends no file');
		await expect(driver.call('POST /x', { Files: [new Blob(['x'])] })).rejects.toThrow('sends no file');

		expect(request).not.toHaveBeenCalled();
	});

	test('Rethrows a network failure without the SDK error and its credentials', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'super-secret-token' });
		const authorization = `Basic ${Buffer.from('AC1:super-secret-token').toString('base64')}`;

		// An axios error of the SDK holds the request config with the `Authorization` header.
		const refused = Object.assign(new Error('connect ECONNREFUSED'), {
			isAxiosError: true,
			code: 'ECONNREFUSED',
			config: { headers: { Authorization: authorization } },
		});

		request.mockRejectedValueOnce(refused);

		const error = (await driver.call('GET /2010-04-01/Accounts.json').catch((e: unknown) => e)) as Error;

		expect(error.message).toBe('Twilio: ECONNREFUSED: connect ECONNREFUSED');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain(authorization);
		expect(error.message).not.toContain('super-secret-token');

		// The SDK's timeout gets the same deadline `call()` races it against, so it usually wins the race.
		const timedOut = Object.assign(new Error('timeout of 5000ms exceeded'), {
			isAxiosError: true,
			code: 'ECONNABORTED',
			config: { headers: { Authorization: authorization }, timeout: 5_000 },
		});

		request.mockRejectedValueOnce(timedOut);

		const timeout = (await driver.call('GET /2010-04-01/Accounts.json').catch((e: unknown) => e)) as Error;

		expect(timeout).toBeInstanceOf(TimeoutError);
		expect(timeout).toMatchObject({ name: 'TimeoutError', message: 'Timed out after 5000 ms', ms: 5_000 });
		expect(timeout.cause).toBeUndefined();
		expect(JSON.stringify(timeout)).not.toContain(authorization);

		create.mockRejectedValueOnce(timedOut);

		const sendError = (await driver
			.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })
			.catch((e: unknown) => e)) as Error;

		expect(sendError).toBeInstanceOf(TimeoutError);
		expect(sendError.cause).toBeUndefined();
		expect(JSON.stringify(sendError)).not.toContain(authorization);
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(
			driver.call('GET /2010-04-01/Accounts.json', {}, { signal: AbortSignal.abort(new Error('stop')) }),
		).rejects.toThrow('stop');

		expect(request).not.toHaveBeenCalled();
	});

	test('Fails with TimeoutError when the SDK does not answer in time', async () => {
		request.mockReturnValueOnce(new Promise(() => {}));

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(driver.call('GET /2010-04-01/Accounts.json', {}, { timeout: 10 })).rejects.toBeInstanceOf(
			TimeoutError,
		);
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		const headers = { 'Twilio-Request-Id': 'RQ1', 'X-Home': 'us1' };

		request.mockResolvedValueOnce({ statusCode: 200, body: { sid: 'SM1' }, headers });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		await expect(driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages/SM1.json')).resolves.toStrictEqual({
			status: 200,
			headers: { 'twilio-request-id': 'RQ1', 'x-home': 'us1' },
			data: { sid: 'SM1' },
		});
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		const answer = { statusCode: 200, body: {}, headers: {} };

		request.mockResolvedValueOnce(answer).mockResolvedValueOnce(answer);

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// `{AccountSid}` is still filled from the location.
		await driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages/{sid}.json', { sid: 'SM 1/x', PageSize: 5 });

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				uri: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM%201%2Fx.json',
				params: { PageSize: 5 },
			}),
		);

		await driver.call('POST /2010-04-01/Accounts/{AccountSid}/Messages/{sid}.json', { sid: 'SM1', Body: '' });

		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({
				uri: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1.json',
				data: { Body: '' },
			}),
		);
	});

	test('Refuses a {name} no parameter fills before any request', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// Sent, it would reach Twilio as `%7Bsid%7D`.
		await expect(driver.call('GET /2010-04-01/Accounts/{AccountSid}/Messages/{sid}.json')).rejects.toThrow('{sid}');
		expect(request).not.toHaveBeenCalled();
	});
});
