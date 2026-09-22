/**
 * Tests of the Lemon Squeezy JSON:API client on a fake fetch — the requests recorded, the responses queued: the
 * headers every request carries, how a refusal reads as an error, and the timeout it enforces and refuses.
 */
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
