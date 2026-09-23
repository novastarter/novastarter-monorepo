/**
 * Tests of the Mailtrap driver class with the SDK mocked and `fetch` stubbed for `call()`; the mapper has its own
 * suite in `to-mailtrap-mail.test.ts`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
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
	// 1. A real `Response`, so the driver reads it the way it reads Mailtrap's
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
 * Spy standing in for `MailtrapClient.send()`, shared by every instance so a test can script the API's answer.
 *
 * @internal
 */
const send = vi.fn();

/**
 * Spy standing in for `MailtrapClient.general.accounts.getAllAccounts()`, the call `verify()` makes.
 *
 * @internal
 */
const getAllAccounts = vi.fn();

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
		 * The accounts API the driver verifies through, routed to the shared spy.
		 *
		 * @internal
		 */
		general = { accounts: { getAllAccounts } };

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
		// 1. Every configuration error is reported by the option's name, before the SDK gets to refuse a send
		expect(() => new MailDriverMailtrap({ token: '' })).toThrow('"token"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true })).toThrow('"testInboxId"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 1, bulk: true })).toThrow('at once');
		expect(defaultExport).toBe(MailDriverMailtrap);
	});

	test('Builds the client for sending, the sandbox and the bulk stream', () => {
		// 1. Plain sending: both flags off
		new MailDriverMailtrap({ token: 't' });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: false });

		// 2. Sandbox: the inbox goes along
		new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 123 });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: true, bulk: false, testInboxId: 123 });

		// 3. Bulk: the marketing stream, so the client gets the bulk host while sandbox stays off
		new MailDriverMailtrap({ token: 't', bulk: true });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: true });
	});

	test('Sends and maps the result', async () => {
		// 1. Mailtrap answers a list of message ids; the first one is the message's
		send.mockResolvedValueOnce({ success: true, message_ids: ['0c7fd939-02cf-11ed-88c2-0a58a9feac02'] });

		const driver = new MailDriverMailtrap({ token: 't' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		// 2. Recipients went out as address objects, the display name of a string form parsed, not dropped
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: [{ email: 'ada@example.com', name: 'Ada' }, { email: 'bob@example.com' }],
				subject: 'S',
			}),
		);

		// 3. Every recipient counts as accepted
		expect(result).toStrictEqual({
			messageId: '0c7fd939-02cf-11ed-88c2-0a58a9feac02',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// 1. The SDK's `MailtrapError` is wrapped, not replaced: the cause keeps its list of Mailtrap's errors
		const refusal = new Error("'to' address is required");

		send.mockRejectedValueOnce(refusal);

		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: "Mailtrap: 'to' address is required",
			cause: refusal,
		});
	});

	test('Surfaces a local mapping failure without the provider prefix', async () => {
		// 1. A message without a sender is refused by the mapper itself, before any request: the kit's own error
		//    stands alone, without the provider prefix the API refusal would get
		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', subject: 'S' })).rejects.toMatchObject({
			message: 'Mailtrap needs a "from" address',
		});

		// 2. The refusal happened before the API, so the client never sent anything
		expect(send).not.toHaveBeenCalled();
	});

	test('Verifies by listing the accounts of the token', async () => {
		const driver = new MailDriverMailtrap({ token: 't' });

		// 1. At least one account means the token can send
		getAllAccounts.mockResolvedValueOnce([{ id: 1, name: 'Acme' }]);
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. None means it cannot, even though Mailtrap answered
		getAllAccounts.mockResolvedValueOnce([]);
		await expect(driver.verify()).rejects.toThrow('no account');

		// 3. A refusal is wrapped with the provider's name, the SDK's error as the cause
		getAllAccounts.mockRejectedValueOnce(new Error('Unauthorized'));
		await expect(driver.verify()).rejects.toThrow('Mailtrap: Unauthorized');
	});
});

describe('call', () => {
	test('Sends a GET to the general API with the query and the Bearer token, and answers the parsed body', async () => {
		answer([{ id: 1, name: 'Acme', access_levels: [1000] }]);

		// 1. The path goes under `https://mailtrap.io`, the parameters into the query
		const { data } = await new MailDriverMailtrap({ token: 'TOKEN' }).call('GET /api/accounts', { page: 2 });

		expect(data).toStrictEqual([{ id: 1, name: 'Acme', access_levels: [1000] }]);
		expect(fetched().url).toBe('https://mailtrap.io/api/accounts?page=2');
		expect(fetched().init.method).toBe('GET');
		expect(fetched().init.headers['authorization']).toBe('Bearer TOKEN');
		expect(fetched().init.body).toBeUndefined();
	});

	test('Sends a POST to a sending host as a JSON body, with the caller headers on top and its own timeout', async () => {
		answer({ success: true, message_ids: ['m-1'] });

		// 1. A full URL on one of Mailtrap's sending hosts is allowed
		const driver = new MailDriverMailtrap({ token: 'TOKEN' });
		const mail = { from: { email: 'me@acme.test' }, to: [{ email: 'ada@example.com' }], subject: 'S', text: 'T' };

		await expect(
			driver.call('POST https://send.api.mailtrap.io/api/send', mail, { headers: { 'X-Trace': '1' } }),
		).resolves.toMatchObject({ data: { success: true, message_ids: ['m-1'] } });

		expect(fetched().url).toBe('https://send.api.mailtrap.io/api/send');
		expect(JSON.parse(fetched().init.body as string)).toStrictEqual(mail);
		expect(fetched().init.headers).toMatchObject({ authorization: 'Bearer TOKEN', 'x-trace': '1' });

		// 2. The caller's timeout replaces the default one
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /api/accounts', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Turns an error status into ProviderCallError without the token in the message', async () => {
		answer({ error: 'Incorrect API token' }, 401);

		// 1. The status and Mailtrap's answer are kept; the message names Mailtrap's reason
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

		// 2. The token never reaches the message
		expect(error.message).not.toContain('SECRET-TOKEN');
	});

	test('Turns a 429 into HitRateLimitError', async () => {
		answer({ errors: ['Rate limit exceeded'] }, 429, { 'retry-after': '5' });

		// 1. The caller may try again later rather than treat it as a refusal
		await expect(new MailDriverMailtrap({ token: 't' }).call('GET /api/accounts')).rejects.toBeInstanceOf(
			HitRateLimitError,
		);
	});

	test('Refuses a URL on a foreign host before any request', async () => {
		// 1. The token never leaves for another host, a look-alike included; nothing is fetched
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

		// 1. A GET: the placeholder takes `id`, URL-encoded; the other parameters stay in the query
		await driver.call('GET /api/accounts/{id}', { id: 'a/b', limit: 5 });
		expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://mailtrap.io/api/accounts/a%2Fb?limit=5');

		// 2. A POST: the placeholder's parameter is not in the body
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

		// 1. Every call answers the whole response, headers named in lower case
		const answer = await driver.call('GET /api/accounts/{id}', { id: 'x' });

		expect(answer).toMatchObject({ status: 201, headers: { 'x-ratelimit-remaining': '9' }, data: { ok: true } });
	});
});
