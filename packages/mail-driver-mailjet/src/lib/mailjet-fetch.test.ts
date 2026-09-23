/**
 * Tests of `quoteUnsafeIntegers` and `mailjetFetch`: Mailjet's 64-bit ids kept exact in a `call()` answer.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mailjetFetch, quoteUnsafeIntegers } from './mailjet-fetch.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('quoteUnsafeIntegers', () => {
	test('Quotes an integer above the safe range, and only that', () => {
		// 1. The id keeps its digits; a safe integer, a fraction and an exponent stay numbers
		expect(quoteUnsafeIntegers('{"ID":1152921504606847023,"n":-9007199254740993,"a":7,"b":1.5,"c":1e300}')).toBe(
			'{"ID":"1152921504606847023","n":"-9007199254740993","a":7,"b":1.5,"c":1e+300}',
		);
	});

	test('Leaves a text without unsafe integers, or one that is not JSON, byte for byte', () => {
		// 1. Formatting survives when there is nothing to quote, and a broken body is not touched
		expect(quoteUnsafeIntegers('{ "a": 1 }')).toBe('{ "a": 1 }');
		expect(quoteUnsafeIntegers('not json 1152921504606847023')).toBe('not json 1152921504606847023');
	});
});

describe('mailjetFetch', () => {
	test('Rewrites a 2xx body and drops its stale length, and passes an error answer through untouched', async () => {
		const ok = new Response('{"ID":1152921504606847023}', {
			status: 200,
			headers: { 'content-type': 'application/json', 'content-length': '26' },
		});

		const refused = new Response('{"ID":1152921504606847023}', { status: 400 });
		const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(refused);

		vi.stubGlobal('fetch', fetchMock);

		const init = { method: 'GET', headers: {}, signal: new AbortController().signal, redirect: 'manual' as const };

		// 1. A success is rebuilt with the id quoted, its other headers kept
		const rewritten = await mailjetFetch('https://api.mailjet.com/v3/REST/message', init);

		expect(await rewritten.text()).toBe('{"ID":"1152921504606847023"}');
		expect(rewritten.headers.get('content-type')).toBe('application/json');
		expect(rewritten.headers.get('content-length')).toBeNull();

		// 2. An error answer is the very response `fetch` gave, and no `body: undefined` was passed on
		expect(await mailjetFetch('https://api.mailjet.com/x', init)).toBe(refused);
		expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
	});
});
