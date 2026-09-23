/**
 * Tests of the Resend driver class with the SDK mocked; the message mapper has its own tests in
 * `to-resend-email.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverResend } from './driver.js';

/**
 * Spy standing in for `Emails.send()`, shared by every instance so a test can script Resend's answer and inspect the
 * payload the driver hands over.
 *
 * @internal
 */
const send = vi.fn();

vi.mock('resend', () => ({
	/**
	 * Stand-in for the `Resend` class of the SDK: exposes the emails API as the shared spy, so each test can script
	 * Resend's answer and inspect the request.
	 */
	Resend: class {
		/**
		 * Emails API the driver calls, recorded so the tests can check the payload it received.
		 *
		 * @internal
		 */
		emails = { send };

		/**
		 * Take the API key the way the real SDK does.
		 *
		 * @param apiKey - The key the driver passes; unused by the mock.
		 */
		constructor(public apiKey: string) {}
	},
}));

/**
 * The stubbed `fetch` the raw calls go through.
 *
 * @internal
 */
const fetchMock = vi.fn();

/**
 * The URL and the init of the first `fetch` call.
 *
 * @returns The URL and the init, headers as the record `httpCall()` builds.
 * @internal
 */
const sent = (): { url: string; init: RequestInit & { headers: Record<string, string> } } => {
	// 1. Read back from the stub, as `fetch(url, init)` was called
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

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

describe('MailDriverResend', () => {
	test('Sends and answers the id, throws on the SDK error value with it as the cause', async () => {
		// 1. A successful send answers the id Resend assigned
		send.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null });

		const driver = new MailDriverResend({ apiKey: 're_test' });
		const message = { to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' };

		expect(await driver.send(message)).toStrictEqual({
			messageId: 'email-1',
			accepted: ['ada@example.com'],
			rejected: [],
		});

		expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'no-reply@acme.test', to: ['ada@example.com'] }));

		// 2. The SDK reports failures as a value; the driver turns them into a throw naming the provider and keeps the
		//    value as the cause, so the caller can read the status code
		const error = { name: 'invalid_from_address', message: 'Verify the domain', statusCode: 422 };

		send.mockResolvedValueOnce({ data: null, error });

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Resend: invalid_from_address: Verify the domain',
			cause: error,
		});

		// 3. A missing key is refused by name
		expect(() => new MailDriverResend({ apiKey: '' })).toThrow(/"apiKey"/);
		expect(defaultExport).toBe(MailDriverResend);
	});

	test('Sends attachments base64-encoded, a text body read into bytes first', async () => {
		// 1. The mapper runs unmocked: the payload Resend receives must carry base64, never raw text or a local path
		send.mockResolvedValueOnce({ data: { id: 'email-2' }, error: null });

		const driver = new MailDriverResend({ apiKey: 're_test' });

		await driver.send({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Hi',
			text: 'x',
			attachments: [{ filename: 'report.csv', content: 'id,name\n1,Ada' }],
		});

		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				attachments: [{ filename: 'report.csv', content: Buffer.from('id,name\n1,Ada').toString('base64') }],
			}),
		);
	});
});

describe('MailDriverResend.call', () => {
	test('Sends a GET with the query and the bearer key, and a POST with a JSON body', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const driver = new MailDriverResend({ apiKey: 're_SECRET' });

		// 1. A GET carries its parameters in the query and answers the parsed JSON
		expect(await driver.call('GET /domains', { limit: 10 })).toStrictEqual({ data: [] });
		expect(sent().url).toBe('https://api.resend.com/domains?limit=10');
		expect(sent().init.method).toBe('GET');
		expect(sent().init.headers['authorization']).toBe('Bearer re_SECRET');

		// 2. A POST carries them in the body; an empty answer is `undefined`
		expect(await driver.call('POST /audiences/a1/contacts', { email: 'ada@example.com' })).toBeUndefined();

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];

		expect(url).toBe('https://api.resend.com/audiences/a1/contacts');
		expect(init.body).toBe('{"email":"ada@example.com"}');
		expect(init.headers['content-type']).toBe('application/json');
	});

	test('Turns an error status into ProviderCallError without the key, and a 429 into HitRateLimitError', async () => {
		const body = { statusCode: 404, name: 'not_found', message: 'Domain not found' };

		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 404 }));

		fetchMock.mockResolvedValueOnce(
			new Response('{"name":"rate_limit_exceeded"}', { status: 429, headers: { 'retry-after': '2' } }),
		);

		const driver = new MailDriverResend({ apiKey: 're_SECRET' });

		// 1. The provider's status and answer in the extensions; the key nowhere in the message
		const error = await driver.call('GET /domains/d1').catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error).toMatchObject({ extensions: { provider: 'resend', method: 'GET /domains/d1', status: 404, body } });
		expect((error as Error).message).toBe('resend refused GET /domains/d1: 404 Domain not found');
		expect((error as Error).message).not.toContain('SECRET');

		// 2. Too many requests is the rate-limit error
		await expect(driver.call('GET /domains')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a full URL on another host before any request, and accepts one on api.resend.com', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverResend({ apiKey: 're_SECRET' });

		// 1. The key must not travel to someone else's host
		await expect(driver.call('GET https://evil.example/domains')).rejects.toThrow(/not on a host of this provider/);
		expect(fetchMock).not.toHaveBeenCalled();

		// 2. Resend's own host is fine
		await driver.call('GET https://api.resend.com/api-keys');
		expect(sent().url).toBe('https://api.resend.com/api-keys');
	});

	test('Takes extra headers and a timeout per call', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverResend({ apiKey: 're_SECRET' });

		// 1. The caller's headers go on top of the driver's
		await driver.call('POST /emails/batch', {}, { headers: { 'Idempotency-Key': 'k1' } });
		expect(sent().init.headers['idempotency-key']).toBe('k1');

		// 2. A request that only ends when its signal aborts gives up at the caller's timeout
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /domains', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});
});
