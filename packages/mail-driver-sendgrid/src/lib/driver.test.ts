/**
 * Tests of the SendGrid driver class with the SDK and the global `fetch` mocked; the message mapper has its own tests
 * in `to-sendgrid-mail.test.ts`.
 */
import { HitRateLimitError, InvalidConfigError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { MailDriverSendgrid } from './driver.js';

/**
 * Spy standing in for `MailService.send()`, shared by every instance so a test can script SendGrid's answer and
 * inspect the payload the driver hands over.
 *
 * @internal
 */
const send = vi.fn();

/**
 * Spy standing in for `MailService.setApiKey()`, so a test can check the key the driver received.
 *
 * @internal
 */
const setApiKey = vi.fn();

vi.mock('@sendgrid/mail', () => ({
	/**
	 * Stand-in for the `MailService` class of `@sendgrid/mail`: its key setter and `send()` are the shared spies, so
	 * each test can script SendGrid's answer and inspect the key and payload the driver hands over.
	 */
	MailService: class {
		/**
		 * Key setter the driver calls in its constructor, recorded so the tests can check the key it received.
		 *
		 * @internal
		 */
		setApiKey = setApiKey;

		/**
		 * Request sender the driver calls, scripted per test with SendGrid's response tuple or error.
		 *
		 * @internal
		 */
		send = send;
	},
}));

/**
 * The stubbed `fetch` the raw calls go through.
 *
 * @internal
 */
const fetchMock = vi.fn();

/**
 * The URL and the init of the last `fetch` call.
 *
 * @returns The URL and the init, headers as the record `httpCall()` builds.
 * @internal
 */
const sent = (): { url: string; init: RequestInit & { headers: Record<string, string>; signal: AbortSignal } } => {
	const [url, init] = fetchMock.mock.lastCall as [
		string,
		RequestInit & { headers: Record<string, string>; signal: AbortSignal },
	];

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

describe('MailDriverSendgrid', () => {
	test('Sets the key, sends and reads the message id from the response headers', async () => {
		send.mockResolvedValueOnce([{ statusCode: 202, headers: { 'x-message-id': 'sg-1' } }, {}]);

		const driver = new MailDriverSendgrid({ apiKey: 'SG.test' });

		expect(setApiKey).toHaveBeenCalledWith('SG.test');

		// The message id is the response header; the status code is the response line
		expect(
			await driver.send({ to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' }),
		).toStrictEqual({
			messageId: 'sg-1',
			accepted: ['ada@example.com'],
			rejected: [],
			response: '202',
		});

		const failure = new Error('Forbidden');

		send.mockRejectedValueOnce(failure);

		await expect(driver.send({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x' })).rejects.toMatchObject({
			message: 'SendGrid: Forbidden',
			cause: failure,
		});

		expect(() => new MailDriverSendgrid({ apiKey: '' })).toThrow(/"apiKey"/);
		expect(() => new MailDriverSendgrid({ apiKey: '' })).toThrow(InvalidConfigError);
		expect(entry.MailDriverSendgrid).toBe(MailDriverSendgrid);
	});

	test('Surfaces a local mapping failure without the provider prefix', async () => {
		// The mapper refuses a message without a sender before any request, so the kit's own error stands without the
		// provider prefix an API refusal would get
		const driver = new MailDriverSendgrid({ apiKey: 'SG.test' });

		await expect(driver.send({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
			message: 'Invalid payload. SendGrid needs a "from" address.',
		});

		expect(send).not.toHaveBeenCalled();
	});
});

describe('MailDriverSendgrid.call', () => {
	test('Sends a GET with the key and the query in the URL, and a POST with the params as the body', async () => {
		fetchMock.mockResolvedValueOnce(new Response('[{"email":"ada@example.com"}]', { status: 200 }));

		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });

		const { data } = await driver.call('GET /v3/suppression/bounces', { limit: 100, email: ['a@b', 'c@d'] });

		expect(data).toStrictEqual([{ email: 'ada@example.com' }]);

		expect(sent().url).toBe('https://api.sendgrid.com/v3/suppression/bounces?limit=100&email=a%40b&email=c%40d');
		expect(sent().init.method).toBe('GET');
		expect(sent().init.body).toBeUndefined();
		expect(sent().init.headers['authorization']).toBe('Bearer SG.SECRET');

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

		const body = { recipient_emails: ['ada@example.com'] };

		expect(
			(await driver.call('POST /v3/asm/suppressions/global', body, { headers: { 'On-Behalf-Of': 'sub' } })).data,
		).toBeUndefined();

		expect(sent().url).toBe('https://api.sendgrid.com/v3/asm/suppressions/global');
		expect(sent().init.method).toBe('POST');
		expect(sent().init.body).toBe(JSON.stringify(body));
		expect(sent().init.headers['on-behalf-of']).toBe('sub');
		expect(sent().init.headers['content-type']).toBe('application/json');
	});

	test('Turns an error status into ProviderCallError without the key, and a 429 into HitRateLimitError', async () => {
		const body = { errors: [{ field: null, message: 'authorization required' }] };

		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 401 }));

		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });
		const error = await driver.call('GET /v3/user/profile').catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect(error).toMatchObject({
			extensions: { provider: 'sendgrid', method: 'GET /v3/user/profile', status: 401, body },
		});

		expect((error as Error).message).toBe('sendgrid refused GET /v3/user/profile: 401 authorization required');
		expect((error as Error).message).not.toContain('SECRET');
		expect(JSON.stringify(error)).not.toContain('SECRET');
		expect(String((error as Error).cause)).not.toContain('SECRET');

		const limited = JSON.stringify({ errors: [{ message: 'too many requests' }] });

		fetchMock.mockResolvedValueOnce(new Response(limited, { status: 429, headers: { 'retry-after': '1' } }));

		await expect(driver.call('GET /v3/user/profile')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Refuses a full URL on another host before any request, and accepts one on a SendGrid host', async () => {
		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });

		await expect(driver.call('GET https://evil.example/v3/user/profile')).rejects.toThrow(
			/not on a host of this provider/,
		);

		expect(fetchMock).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await driver.call('DELETE https://api.sendgrid.com/v3/suppression/bounces/ada@example.com');

		expect(sent().url).toBe('https://api.sendgrid.com/v3/suppression/bounces/ada@example.com');
		expect(sent().init.method).toBe('DELETE');

		// A full URL is the only way to reach the EU region's host
		fetchMock.mockClear();
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await driver.call('GET https://api.eu.sendgrid.com/v3/user/profile');

		expect(sent().url).toBe('https://api.eu.sendgrid.com/v3/user/profile');
	});

	test('Aborts the request itself at the call’s timeout', async () => {
		// The fetch's own signal must fire, not only the wait end
		fetchMock.mockImplementationOnce(
			(_url: string, init: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => reject(init.signal.reason));
				}),
		);

		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });

		await expect(driver.call('GET /v3/user/profile', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
		expect(sent().init.signal.aborted).toBe(true);
	});

	test('Sends nothing when the signal is already aborted', async () => {
		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });
		const controller = new AbortController();

		controller.abort(new Error('shutdown'));

		await expect(
			driver.call('DELETE /v3/suppression/bounces', { emails: ['a@b.c'] }, { signal: controller.signal }),
		).rejects.toThrow('shutdown');

		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('MailDriverSendgrid.call placeholders and answers', () => {
	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });

		await driver.call('GET /v3/templates/{id}', { id: 'a/b', limit: 5 });
		expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.sendgrid.com/v3/templates/a%2Fb?limit=5');

		await driver.call('POST /v3/templates/{id}/versions', { id: 42, name: 'welcome' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://api.sendgrid.com/v3/templates/42/versions');
		expect(init.body).toBe('{"name":"welcome"}');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		await expect(new MailDriverSendgrid({ apiKey: 'SG.SECRET' }).call('GET /v3/templates/{id}')).rejects.toThrow(
			/"id" parameter/,
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true}', { status: 201, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		const driver = new MailDriverSendgrid({ apiKey: 'SG.SECRET' });

		const answer = await driver.call('GET /v3/templates/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});
