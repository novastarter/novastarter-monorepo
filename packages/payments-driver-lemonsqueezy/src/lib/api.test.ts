/**
 * Tests of the Lemon Squeezy JSON:API client on a fake fetch — the requests recorded, the responses queued: the
 * headers every request carries, how a refusal reads as an error, and the timeout it enforces and refuses.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { describe, expect, test, vi } from 'vitest';
import { type ApiFetch, LemonSqueezyApi, LemonSqueezyApiError, MAX_TIMEOUT } from './api.js';

/**
 * A recorded request of the fake fetch.
 */
interface Call {
	method: string;
	url: string;
	body: unknown;
	headers: Record<string, string>;
	signal: AbortSignal;
}

/**
 * A fake fetch: answers from a queue of responses, records what was asked.
 *
 * @param responses - The responses, in order; a `status` other than 2xx is a refusal.
 * @returns The fetch and the calls it saw.
 */
const fakeFetch = (responses: { status?: number; body?: unknown }[]) => {
	// 1. The calls are kept outside the fetch, so a test reads them after the client has sent
	const calls: Call[] = [];

	const fetch: ApiFetch = async (url, init) => {
		// 1. The body is recorded parsed, so a test matches objects rather than JSON text
		calls.push({
			method: init.method,
			url,
			body: init.body ? JSON.parse(init.body) : undefined,
			headers: init.headers,
			signal: init.signal,
		});

		// 2. Past the queue the API answers an empty success, so a test only queues what it asserts on
		const next = responses.shift() ?? { status: 200, body: {} };
		const status = next.status ?? 200;

		// 3. `ok` follows the status the way the platform's response does; no body reads as empty text, like a 204
		return {
			status,
			ok: status >= 200 && status < 300,
			headers: new Headers(),
			text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
		};
	};

	return { fetch, calls };
};

describe('LemonSqueezyApi', () => {
	test('Sends the JSON:API headers and the bearer, reads a refusal into an error', async () => {
		// 1. Three answers in a row: a success, a refusal with JSON:API errors, a gateway failure without a body
		const { fetch, calls } = fakeFetch([
			{ status: 200, body: { data: { id: '1' } } },
			{ status: 401, body: { errors: [{ status: '401', title: 'Unauthenticated', detail: 'Bad key' }] } },
			{ status: 500, body: undefined },
		]);

		// 2. A trailing slash on the base URL must not double up in the path
		const api = new LemonSqueezyApi({ apiKey: 'k', fetch, apiUrl: 'https://stand-in.test/v1/' });

		await expect(api.request('GET', '/users/me')).resolves.toStrictEqual({ data: { id: '1' } });

		// 3. The API refuses `application/json`, so both media types and the bearer are on every request
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: 'https://stand-in.test/v1/users/me',
			headers: {
				Authorization: 'Bearer k',
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json',
			},
		});

		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);

		// 4. A refusal names the API's own detail and keeps the status, so a handler can tell a 401 from a 422
		const refusal = await api.request('GET', '/users/me').catch((error: unknown) => error);

		expect(refusal).toBeInstanceOf(LemonSqueezyApiError);
		expect((refusal as LemonSqueezyApiError).message).toBe('Lemon Squeezy 401: Bad key');
		expect((refusal as LemonSqueezyApiError).status).toBe(401);

		// 5. A failure without JSON:API errors is still an error, reported with the status alone
		await expect(api.request('GET', '/users/me')).rejects.toThrow('Lemon Squeezy 500: request failed');
	});

	test('Refuses a timeout the abort signal cannot hold, at construction', () => {
		// 1. A negative, `NaN`, infinite or fractional delay would throw on every request, `0` would abandon every
		//    request immediately, one above the timer's bound would abandon every request after 1 ms — all are refused
		//    before a single request is sent
		for (const timeout of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5, MAX_TIMEOUT + 1]) {
			expect(() => new LemonSqueezyApi({ apiKey: 'k', timeout })).toThrow(RangeError);
		}

		// 2. The bounds of the accepted range are timeouts the signal holds
		expect(() => new LemonSqueezyApi({ apiKey: 'k', timeout: 1 })).not.toThrow();
		expect(() => new LemonSqueezyApi({ apiKey: 'k', timeout: MAX_TIMEOUT })).not.toThrow();
	});

	test('Sends with the platform fetch bound to the global object', async () => {
		// 1. A fetch on the global object that records its receiver, the way a WebIDL operation would insist on it
		const original = globalThis.fetch;
		const receiver = vi.fn();

		globalThis.fetch = function (this: unknown) {
			receiver(this);

			return Promise.resolve(new Response('{}', { status: 200 }));
		} as typeof fetch;

		try {
			const api = new LemonSqueezyApi({ apiKey: 'k' });

			await api.request('GET', '/users/me');

			expect(receiver).toHaveBeenCalledWith(globalThis);
		} finally {
			// 2. Whatever the assertion, the platform fetch is restored for the next test
			globalThis.fetch = original;
		}
	});

	test('Abandons a request that outlives the timeout', async () => {
		// 1. A fetch that never answers on its own and only fails when its signal aborts, like the platform's does
		const fetch: ApiFetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
			});

		// 2. The shortest deadline that still arms a timer, so the test does not wait
		const api = new LemonSqueezyApi({ apiKey: 'k', fetch, timeout: 1 });

		// 3. The abort reason is the `TimeoutError` of `AbortSignal.timeout()`, what a handler checks by name
		await expect(api.request('GET', '/users/me')).rejects.toMatchObject({ name: 'TimeoutError' });
	});
});

describe('LemonSqueezyApi.call', () => {
	/**
	 * A client with a recognisable key on a fetch that answers real `Response`s, headers included.
	 *
	 * @param responses - The responses, in order.
	 * @param config - The base URL or timeout, when not the defaults.
	 * @returns The client and the stub fetch.
	 */
	const setup = (responses: Response[], config: { apiUrl?: string; timeout?: number } = {}) => {
		// 1. The stub answers in order; its calls are the requests the client made
		const fetch = vi.fn<ApiFetch>();

		for (const response of responses) fetch.mockResolvedValueOnce(response);

		return { api: new LemonSqueezyApi({ apiKey: 'lemon-SECRET-key', fetch, ...config }), fetch };
	};

	/**
	 * A JSON:API response.
	 *
	 * @param body - The document; none for an empty answer.
	 * @param status - The HTTP status.
	 * @param headers - The response headers.
	 * @returns The response.
	 */
	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
		new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

	test('Sends a GET from the API root with its query, the JSON:API headers and the bearer key', async () => {
		const { api, fetch } = setup([json({ data: [] })]);

		// 1. The path names the version itself; the brackets of a JSON:API filter are in the key
		await expect(api.call('GET /v1/discounts', { 'filter[store_id]': 1, 'page[size]': 10 })).resolves.toStrictEqual({
			data: [],
		});

		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe('https://api.lemonsqueezy.com/v1/discounts?filter%5Bstore_id%5D=1&page%5Bsize%5D=10');

		expect(init).toMatchObject({
			method: 'GET',
			headers: {
				accept: 'application/vnd.api+json',
				'content-type': 'application/vnd.api+json',
				authorization: 'Bearer lemon-SECRET-key',
			},
		});

		expect(init.body).toBeUndefined();
	});

	test('Posts a JSON:API body under the configured origin, with the caller’s headers and timeout', async () => {
		const { api, fetch } = setup([json(undefined, 204)], { apiUrl: 'http://localhost:4010/v1/' });
		const document = { data: { type: 'orders', id: '1', attributes: { amount: 500 } } };

		// 1. The stand-in's origin with the caller's path; an empty answer is `undefined`
		await expect(
			api.call('POST /v1/orders/1/refund', document, { headers: { 'X-Trace': 't1' }, timeout: 5_000 }),
		).resolves.toBeUndefined();

		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe('http://localhost:4010/v1/orders/1/refund');
		expect(JSON.parse(init.body!)).toStrictEqual(document);
		expect(init.headers['x-trace']).toBe('t1');
	});

	test('Refuses a URL on another host before any request, and reaches one on Lemon Squeezy’s', async () => {
		const { api, fetch } = setup([json({ data: {} })], { apiUrl: 'http://localhost:4010/v1' });

		// 1. The key would travel with the request; the API's own host stays reachable from a stand-in
		await expect(api.call('GET https://evil.example/v1/stores')).rejects.toThrow('evil.example');
		await api.call('GET https://api.lemonsqueezy.com/v1/stores/1');

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]![0]).toBe('https://api.lemonsqueezy.com/v1/stores/1');
	});

	test('Turns an error status into ProviderCallError with the JSON:API errors, and never names the key', async () => {
		const body = { errors: [{ status: '404', title: 'Not Found', detail: 'The related resource does not exist.' }] };
		const { api } = setup([json(body, 404)]);

		// 1. The status and the answer in the extensions; the key neither in the message nor in them
		const error = (await api.call('GET /v1/orders/9').catch((caught: unknown) => caught)) as InstanceType<
			typeof ProviderCallError
		>;

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.extensions).toStrictEqual({ provider: 'lemonsqueezy', method: 'GET /v1/orders/9', status: 404, body });
		expect(error.message).toContain('The related resource does not exist.');
		expect(error.message).not.toContain('SECRET');
		expect(JSON.stringify(error.extensions)).not.toContain('SECRET');
	});

	test('Turns a 429 into HitRateLimitError', async () => {
		const { api } = setup([json({ errors: [] }, 429, { 'retry-after': '3' })]);

		// 1. Reset at the Retry-After the API names
		const error = (await api.call('GET /v1/stores').catch((caught: unknown) => caught)) as InstanceType<
			typeof HitRateLimitError
		>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.extensions.reset.getTime()).toBeGreaterThan(Date.now() + 2_000);
	});

	test('Gives up with TimeoutError at the client’s timeout and aborts the request', async () => {
		const { api, fetch } = setup([], { timeout: 10 });

		// 1. A request that only ends when its signal aborts
		fetch.mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
		);

		await expect(api.call('GET /v1/stores')).rejects.toBeInstanceOf(TimeoutError);
		expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
	});

	test('Keeps a stand-in’s path prefix, forwards redirect: manual and honours paramsIn', async () => {
		const { api, fetch } = setup([json({ data: {} })], { apiUrl: 'http://localhost:4010/proxy/ls/v1' });

		// 1. Only the trailing `/v1` of the base goes; the fetch is told not to follow redirects; a POST's parameters
		//    go in the query when asked
		await api.call('POST /v1/orders/1/refund', { amount: 500 }, { paramsIn: 'query' });

		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe('http://localhost:4010/proxy/ls/v1/orders/1/refund?amount=500');
		expect(init.redirect).toBe('manual');
		expect(init.body).toBeUndefined();
	});
});
