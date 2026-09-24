/**
 * Tests of the Mailgun driver class with the SDK mocked; the message mapper has its own tests in
 * `to-mailgun-message.test.ts`.
 */
import { HitRateLimitError, InvalidConfigError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { DEFAULT_MAILGUN_HOST } from './constants.js';
import { MailDriverMailgun } from './driver.js';

/**
 * Spy standing in for the messages API's `create()`, shared by every client so a test can script Mailgun's answer and
 * inspect the request.
 *
 * @internal
 */
const create = vi.fn();

/**
 * Spy standing in for the domains API's `get()`, the call `verify()` makes.
 *
 * @internal
 */
const get = vi.fn();

/**
 * Stand-in for the `Mailgun` class's `client()` factory: hands out a client whose messages and domains APIs are the
 * shared spies.
 */
const client = vi.fn(() => ({ messages: { create }, domains: { get } }));

vi.mock('mailgun.js', () => ({
	/**
	 * Stand-in for the `Mailgun` class of `mailgun.js`: hands out a client whose messages and domains APIs are the
	 * shared spies, so each test can script Mailgun's answer and inspect the request.
	 */
	default: class {
		/**
		 * Client factory the driver calls, recorded so the tests can check the key, region and timeout it received.
		 *
		 * @internal
		 */
		client = client;

		/**
		 * Take the FormData implementation the way the real SDK does.
		 *
		 * @param formData - The FormData class the driver passes; unused by the mock.
		 */
		constructor(public formData: unknown) {}
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

describe('MailDriverMailgun', () => {
	test('Requires the key and the domain, and is exported by name', () => {
		expect(() => new MailDriverMailgun({ apiKey: '', domain: 'mg.acme.test' })).toThrow(InvalidConfigError);
		expect(() => new MailDriverMailgun({ apiKey: '', domain: 'mg.acme.test' })).toThrow('"apiKey"');
		expect(() => new MailDriverMailgun({ apiKey: 'key', domain: '' })).toThrow('"domain"');
		expect(entry.MailDriverMailgun).toBe(MailDriverMailgun);
	});

	test('Builds the client for the US region by default and for the host given', () => {
		// No host: the US API over https, and a 30 s timeout, since without one the SDK waits forever on a stall
		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test' });

		expect(client).toHaveBeenLastCalledWith({
			username: 'api',
			key: 'key',
			url: `https://${DEFAULT_MAILGUN_HOST}`,
			timeout: 30_000,
		});

		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', host: 'api.eu.mailgun.net', timeout: 5000 });

		expect(client).toHaveBeenLastCalledWith({
			username: 'api',
			key: 'key',
			url: 'https://api.eu.mailgun.net',
			timeout: 5000,
		});

		// A full URL is taken as is, for a local stand-in
		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', host: 'http://localhost:8080' });

		expect(client).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://localhost:8080' }));
	});

	test('Sends on the domain and maps the result', async () => {
		create.mockResolvedValueOnce({ id: '<20260912.1@mg.acme.test>', message: 'Queued. Thank you.', status: 200 });

		const driver = new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', testMode: true });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		expect(create).toHaveBeenCalledWith(
			'mg.acme.test',
			expect.objectContaining({ to: ['Ada <ada@example.com>', 'bob@example.com'], 'o:testmode': true }),
		);

		expect(result).toStrictEqual({
			messageId: '20260912.1@mg.acme.test',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
			response: 'Queued. Thank you.',
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		const refusal = Object.assign(new Error('Forbidden'), { status: 401, details: 'Invalid private key' });

		create.mockRejectedValueOnce(refusal);

		const driver = new MailDriverMailgun({ apiKey: 'bad', domain: 'mg.acme.test' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: 'Mailgun: Forbidden',
			cause: refusal,
		});
	});

	test('Verifies the domain is active', async () => {
		const driver = new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test' });

		get.mockResolvedValueOnce({ name: 'mg.acme.test', state: 'active' });
		await expect(driver.verify()).resolves.toBeUndefined();
		expect(get).toHaveBeenCalledWith('mg.acme.test');

		// Any other state fails, even though Mailgun answered 200
		get.mockResolvedValue({ name: 'mg.acme.test', state: 'unverified' });
		await expect(driver.verify()).rejects.toThrow(InvalidConfigError);
		await expect(driver.verify()).rejects.toThrow('is unverified, not active');
		get.mockReset();

		get.mockRejectedValueOnce(new Error('Domain not found'));
		await expect(driver.verify()).rejects.toThrow('Mailgun: Domain not found');
	});
});

describe('MailDriverMailgun.call', () => {
	test('Sends a GET with the query on the domain, and a POST with a form body, over HTTP Basic', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"items":[]}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{"message":"Address has been added"}', { status: 200 }));

		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' });

		expect((await driver.call('GET /v3/{domain}/events', { event: 'failed', limit: 50 })).data).toStrictEqual({
			items: [],
		});

		expect(sent().url).toBe('https://api.mailgun.net/v3/mg.acme.test/events?event=failed&limit=50');
		expect(sent().init.headers['authorization']).toBe(`Basic ${Buffer.from('api:key-SECRET').toString('base64')}`);

		await driver.call('POST /v3/{domain}/unsubscribes', { address: 'ada@example.com', tag: ['a', 'b'] });

		expect(sent(1).url).toBe('https://api.mailgun.net/v3/mg.acme.test/unsubscribes');
		expect(sent(1).init.body).toBe('address=ada%40example.com&tag=a&tag=b');
		expect(sent(1).init.headers['content-type']).toBe('application/x-www-form-urlencoded');
	});

	test('Turns an error status into ProviderCallError without the key, and a 429 into HitRateLimitError', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"message":"Domain not found"}', { status: 404 }));

		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' });
		const error = await driver.call('GET /v4/domains/{domain}').catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect(error).toMatchObject({
			extensions: {
				provider: 'mailgun',
				method: 'GET /v4/domains/{domain}',
				status: 404,
				body: { message: 'Domain not found' },
			},
		});

		expect((error as Error).message).toBe('mailgun refused GET /v4/domains/{domain}: 404 Domain not found');
		expect((error as Error).message).not.toContain('SECRET');

		fetchMock.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));

		await expect(driver.call('GET /v3/{domain}/bounces')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Accepts a full URL only on the location’s host, refusing another region before any request', async () => {
		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test', host: 'api.eu.mailgun.net' });

		await expect(driver.call('GET https://api.mailgun.net/v3/domains')).rejects.toThrow(
			/not on a host of this provider/,
		);

		await expect(driver.call('GET https://evil.example/v3/domains')).rejects.toThrow(/not on a host of this provider/);
		expect(fetchMock).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const { data } = await driver.call('DELETE https://api.eu.mailgun.net/v3/mg.acme.test/bounces/ada@example.com');

		expect(data).toBeUndefined();

		expect(sent().url).toBe('https://api.eu.mailgun.net/v3/mg.acme.test/bounces/ada@example.com');
	});

	test('Takes extra headers, and the location’s timeout unless the call names its own', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test', timeout: 10 });

		await driver.call('GET /v3/domains', {}, { headers: { 'X-Mailgun-On-Behalf-Of': 'sub-1' } });
		expect(sent().init.headers['x-mailgun-on-behalf-of']).toBe('sub-1');

		const hang = (_url: string, init: RequestInit): Promise<Response> =>
			new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

		fetchMock.mockImplementationOnce(hang);
		await expect(driver.call('GET /v3/domains')).rejects.toBeInstanceOf(TimeoutError);

		fetchMock.mockImplementationOnce(hang);

		await expect(
			new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' }).call(
				'GET /v3/domains',
				{},
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);
	});
});

describe('MailDriverMailgun.call placeholders and answers', () => {
	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' });

		await driver.call('GET /v3/{domain}/tags/{id}', { id: 'a/b', limit: 5 });
		const [first] = fetchMock.mock.calls[0] as [string];

		expect(first).toBe('https://api.mailgun.net/v3/mg.acme.test/tags/a%2Fb?limit=5');

		await driver.call('POST /v3/{domain}/templates/{id}/versions', { id: 42, name: 'welcome' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://api.mailgun.net/v3/mg.acme.test/templates/42/versions');
		expect(init.body).toBe('name=welcome');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		await expect(
			new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' }).call('GET /v3/{domain}/tags/{id}'),
		).rejects.toThrow(/"id" parameter/);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true}', { status: 201, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		const driver = new MailDriverMailgun({ apiKey: 'key-SECRET', domain: 'mg.acme.test' });

		const answer = await driver.call('GET /v3/{domain}/tags/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});
