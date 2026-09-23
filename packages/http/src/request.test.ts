/**
 * Tests of `http/request`: the whole of a driver's `call()` over a stubbed `fetch`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HttpCallFetch } from './http-call.js';
import { type HttpApi, request } from './request.js';

/**
 * The stubbed `fetch`.
 */
const fetchMock = vi.fn<HttpCallFetch>();

/**
 * An API over the stub, with a key the tests make sure never leaks.
 *
 * @param overrides - Fields to set on top.
 * @returns The API.
 */
const api = (overrides: Partial<HttpApi> = {}): HttpApi => {
	// 1. The shape a driver describes once
	return {
		provider: 'acme',
		baseUrl: 'https://api.acme.example/v1',
		hosts: ['files.acme.example'],
		headers: { authorization: 'Bearer SECRET' },
		fetch: fetchMock,
		...overrides,
	};
};

/**
 * The URL and the init of the n-th `fetch` call.
 *
 * @param index - Which call.
 * @returns The URL and the init.
 */
const sent = (index = 0): [string, Parameters<HttpCallFetch>[1]] => {
	// 1. As `fetch(url, init)` was called
	return fetchMock.mock.calls[index] as [string, Parameters<HttpCallFetch>[1]];
};

afterEach(() => {
	fetchMock.mockReset();
});

describe('request', () => {
	test('Answers the status, the lower-cased headers and the body, the placeholders filled', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"id":"p1"}', { status: 200, headers: { 'X-RateLimit-Remaining': '9' } }),
		);

		// 1. `{id}` from the caller, `{org}` from the driver; the rest of the parameters in the query
		await expect(
			request(api({ placeholders: { org: 'o 1' } }), 'GET /orgs/{org}/products/{id}', { id: 'a/b', limit: 2 }),
		).resolves.toMatchObject({ status: 200, headers: { 'x-ratelimit-remaining': '9' }, data: { id: 'p1' } });

		const [url, init] = sent();

		expect(url).toBe('https://api.acme.example/v1/orgs/o%201/products/a%2Fb?limit=2');
		expect(init.headers).toMatchObject({ authorization: 'Bearer SECRET' });
	});

	test('Sends the body, the caller’s headers over the credentials, and the API’s default body type', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		// 1. A form by default for this API; the caller replaces the authorization
		await expect(
			request(
				api({ bodyType: 'form' }),
				'POST /refunds',
				{ amount: 1 },
				{ headers: { Authorization: 'Bearer OTHER' } },
			),
		).resolves.toStrictEqual({ status: 204, headers: {}, data: undefined });

		expect(sent()[1].body).toBe('amount=1');
		expect(sent()[1].headers['authorization']).toBe('Bearer OTHER');
	});

	test('Fetches token headers under the deadline, after the host check', async () => {
		const headers = vi.fn(async () => ({ authorization: 'Bearer TOKEN' }));

		// 1. A foreign host is refused before a token is fetched
		await expect(request(api({ headers }), 'GET https://evil.example/x')).rejects.toThrow('not on a host');
		expect(headers).not.toHaveBeenCalled();

		// 2. A token that never comes ends at the deadline, with no request made
		const hanging = vi.fn(
			(signal: AbortSignal) =>
				new Promise<Record<string, string>>((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason)),
				),
		);

		await expect(request(api({ headers: hanging }), 'GET /x', {}, { timeout: 10 })).rejects.toBeInstanceOf(
			TimeoutError,
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Adds the secret query to the request only, never to an error', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"message":"Nope"}', { status: 403 }));

		// 1. The signature goes with the request
		const error = (await request(api({ headers: {}, query: { sig: 'SIGNATURE' } }), 'GET /x').catch(
			(caught: unknown) => caught,
		)) as Error;

		expect(sent()[0]).toBe('https://api.acme.example/v1/x?sig=SIGNATURE');

		// 2. The error names the status and the reason, nothing of the request
		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('acme refused GET /x: 403 Nope');
		expect(JSON.stringify(error)).not.toContain('SIGNATURE');
	});

	test('Maps a 429 to HitRateLimitError, and lets the driver judge first', async () => {
		fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } }));

		// 1. The kit's mapping
		await expect(request(api(), 'GET /x')).rejects.toBeInstanceOf(HitRateLimitError);

		// 2. The driver's own: a 403 that is a rate limit for this provider
		fetchMock.mockResolvedValueOnce(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));

		const refuse = vi.fn((response: { status: number; headers: Headers }) =>
			response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
				? new Error('rate limited')
				: undefined,
		);

		await expect(request(api({ refuse }), 'GET /x')).rejects.toThrow('rate limited');
		expect(refuse).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }), 'GET /x');
	});

	test('Refuses an unfilled placeholder and a malformed method before any request', async () => {
		// 1. Neither the caller nor the driver filled `{id}`
		await expect(request(api(), 'GET /products/{id}')).rejects.toThrow('needs a "id" parameter');
		await expect(request(api(), 'FETCH /x')).rejects.toThrow('is not');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Replaces a failing token fetch with an error naming the provider only', async () => {
		// 1. A token endpoint's error that quotes the credentials' request
		const headers = async (): Promise<Record<string, string>> => {
			throw new TypeError('token request failed: client_secret=SECRET');
		};

		const error = (await request(api({ headers }), 'GET /x').catch((caught: unknown) => caught)) as Error;

		expect(error.message).toBe('acme: the credentials for the call could not be had (TypeError)');
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain('SECRET');
	});

	test('Refuses a parameter under the name of the secret query', async () => {
		// 1. It would ride along as a second value next to the signature
		await expect(request(api({ query: { sig: 'S' } }), 'GET /x', { sig: 'mine' })).rejects.toThrow(
			'The call parameter "sig" is reserved by the acme driver',
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Tells the API’s hooks of every call, without the credentials or the secret query', async () => {
		const onRequest = vi.fn();
		const onResponse = vi.fn();

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		// 1. Named by the method as the caller wrote it, the URL without the signature
		await request(api({ query: { sig: 'SECRET' }, hooks: { onRequest, onResponse } }), 'GET /products', {
			limit: 1,
		});

		const event = {
			provider: 'acme',
			label: 'GET /products',
			verb: 'GET',
			url: 'https://api.acme.example/v1/products',
		};

		expect(onRequest).toHaveBeenCalledWith(event);
		expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ ...event, status: 204 }));
		expect(JSON.stringify([onRequest.mock.calls, onResponse.mock.calls])).not.toContain('SECRET');
	});
});
