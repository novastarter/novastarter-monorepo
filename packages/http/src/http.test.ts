/**
 * Tests of `http/http`: a request of any URL, on `@octokit/request`, over a stubbed `fetch`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HttpCallFetch } from './http-call.js';
import { http } from './http.js';

/**
 * The stubbed `fetch`.
 */
const fetchMock = vi.fn<HttpCallFetch>();

/**
 * The URL and the init of the n-th `fetch` call.
 *
 * @param index - Which call.
 * @returns The URL and the init.
 */
const sent = (index = 0): [string, Parameters<HttpCallFetch>[1]] => {
	// As `fetch(url, init)` was called
	return fetchMock.mock.calls[index] as [string, Parameters<HttpCallFetch>[1]];
};

afterEach(() => {
	fetchMock.mockReset();
});

describe('http', () => {
	test('Fills the placeholders, puts the other parameters of a GET in the query, and answers the whole response', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"id":1}', { status: 200, headers: { 'content-type': 'application/json', 'X-Trace': 't' } }),
		);

		// `{owner}` and `{repo}` from the parameters, `state` in the query
		await expect(
			http(
				'GET https://api.github.com/repos/{owner}/{repo}/issues',
				{ owner: 'acme', repo: 'web', state: 'open' },
				{
					fetch: fetchMock,
				},
			),
		).resolves.toMatchObject({ status: 200, headers: { 'x-trace': 't' }, data: { id: 1 } });

		expect(sent()[0]).toBe('https://api.github.com/repos/acme/web/issues?state=open');
		expect(sent()[1].headers).toMatchObject({ accept: 'application/json', 'user-agent': 'novastarter' });
	});

	test('Sends the parameters of a POST as JSON with the caller’s headers', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		// An empty answer is nothing
		await expect(
			http(
				'POST https://api.polar.sh/v1/refunds',
				{ order_id: 'o1' },
				{
					headers: { authorization: 'Bearer SECRET' },
					fetch: fetchMock,
				},
			),
		).resolves.toStrictEqual({ status: 204, headers: {}, data: undefined });

		expect(sent()[1].body).toBe('{"order_id":"o1"}');
		expect(sent()[1].headers).toMatchObject({ authorization: 'Bearer SECRET', 'content-type': 'application/json' });
	});

	test('Refuses a path without a host and an unfilled placeholder, before any request', async () => {
		// There is no base to put a path under, and `{id}` has nothing to fill it
		await expect(http('GET /v1/products', {}, { fetch: fetchMock })).rejects.toThrow('http() needs a full URL');

		await expect(http('GET https://api.polar.sh/v1/products/{id}', {}, { fetch: fetchMock })).rejects.toThrow(
			'needs a "id" parameter',
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Names an error by the host and the path, never the query or the headers', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"message":"Bad credentials"}', {
				status: 401,
				headers: { 'content-type': 'application/json' },
			}),
		);

		// A key in the query and one in a header stay out of the error
		const error = (await http(
			'GET https://api.example.com/v1/me?api_key=SECRET',
			{},
			{
				headers: { 'x-api-key': 'SECRET' },
				fetch: fetchMock,
			},
		).catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('api.example.com refused GET https://api.example.com/v1/me: 401 Bad credentials');
		expect(JSON.stringify(error)).not.toContain('SECRET');
		expect(error.cause).toBeUndefined();
	});

	test('Maps a 429 to HitRateLimitError and a slow answer to TimeoutError', async () => {
		fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }));

		// The provider asks to slow down
		await expect(http('GET https://api.example.com/x', {}, { fetch: fetchMock })).rejects.toBeInstanceOf(
			HitRateLimitError,
		);

		// An answer that never comes ends at the deadline
		fetchMock.mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
		);

		await expect(http('GET https://api.example.com/x', {}, { timeout: 10, fetch: fetchMock })).rejects.toBeInstanceOf(
			TimeoutError,
		);
	});

	test('Keeps a path as it is: a colon in a segment and a trailing slash', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		// `messages:send` of Google's APIs and Polar's trailing slash reach the provider untouched
		await http(
			'POST https://fcm.googleapis.com/v1/projects/{id}/messages:send',
			{ id: 'p1', message: {} },
			{
				fetch: fetchMock,
			},
		);

		await http('GET https://api.polar.sh/v1/products/', {}, { fetch: fetchMock });

		expect(sent(0)[0]).toBe('https://fcm.googleapis.com/v1/projects/p1/messages:send');
		expect(sent(1)[0]).toBe('https://api.polar.sh/v1/products/');
	});

	test('Reads the answer itself: big numbers stay numbers, repeated headers stay, a broken body throws', async () => {
		// A JSON error with a big number still becomes the kit's error, its body a plain number
		fetchMock.mockResolvedValueOnce(
			new Response('{"error":{"id":9007199254740993}}', {
				status: 422,
				headers: { 'content-type': 'application/json' },
			}),
		);

		const error = (await http('GET https://api.example.com/x', {}, { fetch: fetchMock }).catch(
			(caught: unknown) => caught,
		)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(typeof (error.extensions.body as { error: { id: unknown } }).error.id).toBe('number');

		// Two `set-cookie` headers are both there
		const headers = new Headers();

		headers.append('set-cookie', 'a=1');
		headers.append('set-cookie', 'b=2');
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200, headers }));

		await expect(http('GET https://api.example.com/x', {}, { fetch: fetchMock })).resolves.toMatchObject({
			headers: { 'set-cookie': 'a=1, b=2' },
		});

		// A body cut off halfway is an error, not an empty success
		const broken = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"a":'));
				controller.error(new Error('ECONNRESET'));
			},
		});

		fetchMock.mockResolvedValueOnce(new Response(broken, { status: 200 }));

		const cut = await http('GET https://api.example.com/x', {}, { fetch: fetchMock }).catch(
			(caught: unknown) => caught,
		);

		expect(cut).toMatchObject({ name: 'Error', message: 'ECONNRESET' });
		expect(cut).not.toHaveProperty('request');
	});

	test('Throws what the fetch threw as it is: the abort reason untouched, a HEAD refused like any other', async () => {
		// Octokit would mark an `AbortError` with `status = 500`; the caller's reason stays as it was
		const controller = new AbortController();
		const reason = Object.freeze(new DOMException('stop', 'AbortError'));

		fetchMock.mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
		);

		const pending = http('GET https://api.example.com/x', {}, { signal: controller.signal, fetch: fetchMock });

		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(reason).not.toHaveProperty('status');

		// An unreachable host is the fetch's own error, not Octokit's
		const unreachable = new TypeError('fetch failed');

		fetchMock.mockRejectedValueOnce(unreachable);

		await expect(http('GET https://api.example.com/x', {}, { fetch: fetchMock })).rejects.toBe(unreachable);

		// A `HEAD` answered 404 is judged like any other verb
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

		await expect(http('HEAD https://api.example.com/x', {}, { fetch: fetchMock })).rejects.toBeInstanceOf(
			ProviderCallError,
		);
	});

	test('Tells the hooks of the request and its answer, without the query, before an error status is thrown', async () => {
		const onRequest = vi.fn();
		const onResponse = vi.fn();
		const onError = vi.fn();

		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }));

		// A success: the request first, then its answer with the status and how long it took
		await http(
			'GET https://api.example.com/v1/{id}?api_key=SECRET',
			{ id: 'a1' },
			{ fetch: fetchMock, hooks: { onRequest, onResponse, onError } },
		);

		const request = { provider: 'api.example.com', verb: 'GET', url: 'https://api.example.com/v1/a1' };

		expect(onRequest).toHaveBeenCalledWith({ ...request, label: 'GET https://api.example.com/v1/a1' });
		expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ ...request, status: 200 }));
		expect(onResponse.mock.calls[0]?.[0].duration).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify([onRequest.mock.calls, onResponse.mock.calls])).not.toContain('SECRET');

		// An error status is an answer too, told before the kit's error is thrown
		await expect(
			http('GET https://api.example.com/x', {}, { fetch: fetchMock, hooks: { onResponse, onError } }),
		).rejects.toBeInstanceOf(HitRateLimitError);

		expect(onResponse).toHaveBeenLastCalledWith(expect.objectContaining({ status: 429 }));
		expect(onError).not.toHaveBeenCalled();
	});

	test('Tells onError of a request with no answer, the error going on to the caller as it is', async () => {
		const onResponse = vi.fn();
		const onError = vi.fn();
		const unreachable = new TypeError('fetch failed');

		// The host cannot be reached
		fetchMock.mockRejectedValueOnce(unreachable);

		await expect(
			http('GET https://api.example.com/x', {}, { fetch: fetchMock, hooks: { onResponse, onError } }),
		).rejects.toBe(unreachable);

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://api.example.com/x', error: unreachable }),
		);

		// The answer never comes
		fetchMock.mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
		);

		await expect(
			http('GET https://api.example.com/x', {}, { timeout: 10, fetch: fetchMock, hooks: { onError } }),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(onError.mock.calls[1]?.[0].error).toBeInstanceOf(TimeoutError);
		expect(onResponse).not.toHaveBeenCalled();
	});

	test('Never lets a failing hook break the request', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"id":1}', { status: 200 }));

		// One hook throws, the other rejects
		await expect(
			http(
				'GET https://api.example.com/x',
				{},
				{
					fetch: fetchMock,
					hooks: {
						onRequest: () => {
							throw new Error('logger down');
						},
						onResponse: async () => {
							throw new Error('metrics down');
						},
					},
				},
			),
		).resolves.toMatchObject({ status: 200, data: { id: 1 } });
	});

	test('Keeps what a hook changes in its event out of the error', async () => {
		fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

		// A hook rewrites the provider it was told of; the error still names the real one
		const error = await http(
			'GET https://api.example.com/x',
			{},
			{
				fetch: fetchMock,
				hooks: {
					onRequest: (event) => {
						event.provider = 'other';
					},
				},
			},
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect((error as Error).message).toContain('api.example.com refused');
	});
});
