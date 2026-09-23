/**
 * Tests of `request`: what reaches the fetch, how a body is read, and how a request without an answer becomes an
 * `AuthProviderFailedError`.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { describe, expect, test, vi } from 'vitest';
import { type AuthFetch, request, toHttpCallFetch } from './request.js';

describe('request', () => {
	test('Sends the method, the headers and the body with a deadline signal, and parses the JSON answer', async () => {
		const fetch = vi.fn<AuthFetch>(async () => ({ status: 200, ok: true, text: async () => '{"a":1}' }));

		const response = await request({ fetch, timeout: 1_000 }, 'https://x.test/token', {
			method: 'POST',
			headers: { Accept: 'application/json' },
			body: 'a=1',
		});

		// 1. The status, the headers and the parsed body come back; the fetch saw the request plus a signal for the
		//    deadline
		expect(response).toStrictEqual({ status: 200, ok: true, body: { a: 1 }, headers: expect.any(Headers) });

		expect(fetch).toHaveBeenCalledWith('https://x.test/token', {
			method: 'POST',
			headers: { Accept: 'application/json' },
			body: 'a=1',
			signal: expect.any(AbortSignal),
		});
	});

	test('Reads a body that is not JSON as none and leaves the status to the caller', async () => {
		// 1. A gateway's HTML page on a 502 is neither an error here nor a body worth passing on
		const fetch: AuthFetch = async () => ({ status: 502, ok: false, text: async () => '<html>Bad gateway</html>' });

		expect(await request({ fetch, timeout: 1_000 }, 'https://x.test', { method: 'GET', headers: {} })).toStrictEqual({
			status: 502,
			ok: false,
			body: undefined,
			headers: expect.any(Headers),
		});
	});

	test('Throws a provider failure for a network error and for a request past its deadline', async () => {
		// 1. The network error travels as the cause, and the reason names the URL
		const socket = new Error('ECONNRESET');

		const failing: AuthFetch = async () => {
			throw socket;
		};

		const error = await request({ fetch: failing, timeout: 1_000 }, 'https://x.test', {
			method: 'GET',
			headers: {},
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);

		expect(error).toMatchObject({
			message: 'The github sign-in failed: the request to https://x.test failed: ECONNRESET',
			cause: socket,
		});

		// 2. A fetch that never answers is abandoned at the deadline, and the abort reaches its signal
		let seen: AbortSignal | undefined;

		const hanging: AuthFetch = (_url, init) => {
			seen = init.signal;

			return new Promise(() => {});
		};

		await expect(
			request({ fetch: hanging, timeout: 5 }, 'https://x.test', { method: 'GET', headers: {} }),
		).rejects.toThrow('the request to https://x.test failed: Timed out after 5 ms');

		expect(seen?.aborted).toBe(true);
	});
});

describe('toHttpCallFetch', () => {
	test('Forwards the whole request, redirect and multipart body included; keeps a Response', async () => {
		// 1. The platform's answer passes through untouched
		const real = new Response('{}', { status: 200, headers: { 'x-a': '1' } });
		const fetch = vi.fn<AuthFetch>(async () => real);
		const body = new FormData();
		const signal = new AbortController().signal;

		const response = await toHttpCallFetch(fetch)('https://x.test', {
			method: 'POST',
			headers: {},
			body,
			signal,
			redirect: 'manual',
		});

		expect(response).toBe(real);

		// 2. `redirect: 'manual'` reaches the fetch, so it cannot follow a redirect with the credentials
		expect(fetch.mock.calls[0]![1]).toStrictEqual({
			method: 'POST',
			headers: {},
			body,
			signal,
			redirect: 'manual',
		});
	});

	test('Gives a fake answer without headers empty ones', async () => {
		// 1. A narrow fake answers status and text only; `httpCall()` still reads headers of it
		const fetch = vi.fn<AuthFetch>(async () => ({ status: 204, ok: true, text: async () => '' }));

		const response = await toHttpCallFetch(fetch)('https://x.test', {
			method: 'GET',
			headers: {},
			signal: new AbortController().signal,
			redirect: 'manual',
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('location')).toBeNull();
		expect(await response.text()).toBe('');
	});
});
