/**
 * Tests of the Mailtrap driver class with the SDK mocked and `fetch` stubbed for `call()`; the mapper has its own
 * suite in `to-mailtrap-mail.test.ts`.
 */
import { HitRateLimitError, InvalidConfigError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { MailDriverMailtrap } from './driver.js';

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
	// A real `Response`, so the driver reads it the way it reads Mailtrap's
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
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }];

	return { url, init };
};

/**
 * Spy standing in for `MailtrapClient.send()`, shared by every instance so a test can script the API's answer.
 *
 * @internal
 */
const send = vi.fn();

/**
 * Spy recording the options every `MailtrapClient` was built with, so a test can check the host flags.
 *
 * @internal
 */
const construct = vi.fn();

vi.mock('mailtrap', () => ({
	/**
	 * Stand-in for the SDK's `MailtrapClient`: only the surface the driver touches, wired to the shared spies.
	 */
	MailtrapClient: class {
		/**
		 * The sending call, routed to the shared spy.
		 *
		 * @internal
		 */
		send = send;

		/**
		 * The general API, which throws without an account id the way the SDK's getter does, so a `verify()` that
		 * went through it would fail here as it fails against Mailtrap.
		 *
		 * @internal
		 */
		get general(): never {
			// The driver never passes an account id, so the SDK's check always refuses
			throw new Error('accountId is missing, some features of testing API may not work properly.');
		}

		/**
		 * Record the client options instead of opening a connection.
		 *
		 * @param options - What the driver passed to the SDK.
		 */
		constructor(options: unknown) {
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

describe('MailDriverMailtrap', () => {
	test('Requires the token, an inbox in sandbox mode, and not both sandbox and bulk', () => {
		expect(() => new MailDriverMailtrap({ token: '' })).toThrow(InvalidConfigError);
		expect(() => new MailDriverMailtrap({ token: '' })).toThrow('"token"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true })).toThrow('"testInboxId"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 1, bulk: true })).toThrow('at once');
		expect(entry.MailDriverMailtrap).toBe(MailDriverMailtrap);
	});

	test('Builds the client for sending, the sandbox and the bulk stream', () => {
		new MailDriverMailtrap({ token: 't' });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: false });

		new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 123 });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: true, bulk: false, testInboxId: 123 });

		// Bulk is the marketing stream, so the client gets the bulk host while sandbox stays off
		new MailDriverMailtrap({ token: 't', bulk: true });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: true });
	});

	test('Sends and maps the result', async () => {
		// Mailtrap answers a list of message ids; the first one is the message's
		send.mockResolvedValueOnce({ success: true, message_ids: ['0c7fd939-02cf-11ed-88c2-0a58a9feac02'] });

		const driver = new MailDriverMailtrap({ token: 't' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		// The display name of a string recipient is parsed, not dropped
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: [{ email: 'ada@example.com', name: 'Ada' }, { email: 'bob@example.com' }],
				subject: 'S',
			}),
		);

		expect(result).toStrictEqual({
			messageId: '0c7fd939-02cf-11ed-88c2-0a58a9feac02',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// The SDK's `MailtrapError` is wrapped, not replaced, so the cause keeps its list of Mailtrap's errors
		const refusal = new Error("'to' address is required");

		send.mockRejectedValueOnce(refusal);

		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: "Mailtrap: 'to' address is required",
			cause: refusal,
		});
	});

	test('Surfaces a local mapping failure without the provider prefix', async () => {
		// The mapper refuses a message without a sender before any request, so the kit's own error stands without the
		// provider prefix an API refusal would get
		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', subject: 'S' })).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
			message: 'Invalid payload. Mailtrap needs a "from" address.',
		});

		expect(send).not.toHaveBeenCalled();
	});

	test('Verifies by listing the accounts of the token through the API, not the SDK', async () => {
		const driver = new MailDriverMailtrap({ token: 'TOKEN' });

		// At least one account means the token can send
		answer([{ id: 1, name: 'Acme' }]);
		await expect(driver.verify()).resolves.toBeUndefined();
		expect(fetched().url).toBe('https://mailtrap.io/api/accounts');
		expect(fetched().init.method).toBe('GET');
		expect(fetched().init.headers['authorization']).toBe('Bearer TOKEN');

		// No account means the token cannot send, even though Mailtrap answered
		answer([]);
		const refused = driver.verify();
		await expect(refused).rejects.toThrow(InvalidConfigError);
		await expect(refused).rejects.toThrow('with access to an account');

		answer({ error: 'Incorrect API token' }, 401);
		await expect(driver.verify()).rejects.toBeInstanceOf(ProviderCallError);
	});
});

describe('call', () => {
	test('Sends a GET to the general API with the query and the Bearer token, and answers the parsed body', async () => {
		answer([{ id: 1, name: 'Acme', access_levels: [1000] }]);

		const { data } = await new MailDriverMailtrap({ token: 'TOKEN' }).call('GET /api/accounts', { page: 2 });

		expect(data).toStrictEqual([{ id: 1, name: 'Acme', access_levels: [1000] }]);
		expect(fetched().url).toBe('https://mailtrap.io/api/accounts?page=2');
		expect(fetched().init.method).toBe('GET');
		expect(fetched().init.headers['authorization']).toBe('Bearer TOKEN');
		expect(fetched().init.body).toBeUndefined();
	});

	test('Sends a POST to a sending host as a JSON body, with the caller headers on top and its own timeout', async () => {
		answer({ success: true, message_ids: ['m-1'] });

		const driver = new MailDriverMailtrap({ token: 'TOKEN' });
		const mail = { from: { email: 'me@acme.test' }, to: [{ email: 'ada@example.com' }], subject: 'S', text: 'T' };

		await expect(
			driver.call('POST https://send.api.mailtrap.io/api/send', mail, { headers: { 'X-Trace': '1' } }),
		).resolves.toMatchObject({ data: { success: true, message_ids: ['m-1'] } });

		expect(fetched().url).toBe('https://send.api.mailtrap.io/api/send');
		expect(JSON.parse(fetched().init.body as string)).toStrictEqual(mail);
		expect(fetched().init.headers).toMatchObject({ authorization: 'Bearer TOKEN', 'x-trace': '1' });

		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /api/accounts', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Turns an error status into ProviderCallError without the token in the message', async () => {
		answer({ error: 'Incorrect API token' }, 401);

		const error = (await new MailDriverMailtrap({ token: 'SECRET-TOKEN' })
			.call('GET /api/accounts')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);

		expect(error.extensions).toStrictEqual({
			provider: 'mailtrap',
			method: 'GET /api/accounts',
			status: 401,
			body: { error: 'Incorrect API token' },
		});

		expect(error.message).toBe('mailtrap refused GET /api/accounts: 401 Incorrect API token');

		expect(error.message).not.toContain('SECRET-TOKEN');
	});

	test('Turns a 429 into HitRateLimitError', async () => {
		answer({ errors: ['Rate limit exceeded'] }, 429, { 'retry-after': '5' });

		// The caller may try again later rather than treat it as a refusal
		await expect(new MailDriverMailtrap({ token: 't' }).call('GET /api/accounts')).rejects.toBeInstanceOf(
			HitRateLimitError,
		);
	});

	test('Refuses a URL on a foreign host before any request', async () => {
		// The token never leaves for another host, a look-alike included
		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.call('GET https://evil.example/api/accounts')).rejects.toThrow(
			'not on a host of this provider',
		);

		await expect(driver.call('GET https://mailtrap.io.evil.example/api')).rejects.toThrow('not on a host');

		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('MailDriverMailtrap.call placeholders and answers', () => {
	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

		const driver = new MailDriverMailtrap({ token: 't' });

		await driver.call('GET /api/accounts/{id}', { id: 'a/b', limit: 5 });
		expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://mailtrap.io/api/accounts/a%2Fb?limit=5');

		await driver.call('POST /api/accounts/{id}/contacts', { id: 42, name: 'welcome' });

		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

		expect(url).toBe('https://mailtrap.io/api/accounts/42/contacts');
		expect(init.body).toBe('{"name":"welcome"}');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		await expect(new MailDriverMailtrap({ token: 't' }).call('GET /api/accounts/{id}')).rejects.toThrow(
			/"id" parameter/,
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"ok":true}', { status: 201, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		const driver = new MailDriverMailtrap({ token: 't' });

		const answer = await driver.call('GET /api/accounts/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});
