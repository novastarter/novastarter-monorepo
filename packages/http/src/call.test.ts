/**
 * Tests of `http/call`: the parser of a driver's `call()` method.
 */
import { describe, expect, test } from 'vitest';
import { parseCallMethod, toHeaderRecord } from './call.js';

describe('parseCallMethod', () => {
	test('Splits a verb and a path or URL, the verb upper-cased', () => {
		// Any case and spacing of the verb
		expect(parseCallMethod('post /v1/refunds')).toStrictEqual({ verb: 'POST', target: '/v1/refunds', params: {} });

		expect(parseCallMethod('  GET   https://files.stripe.com/v1/files ')).toStrictEqual({
			verb: 'GET',
			target: 'https://files.stripe.com/v1/files',
			params: {},
		});
	});

	test('Refuses an unknown verb, a missing target, a relative or protocol-relative one', () => {
		// Each is ambiguous or a typo
		expect(() => parseCallMethod('FETCH /x')).toThrow('@novastarter/http: the call method "FETCH /x" is not');
		expect(() => parseCallMethod('GET')).toThrow('is not');
		expect(() => parseCallMethod('GET customers')).toThrow('neither a path');
		expect(() => parseCallMethod('GET //evil.example/x')).toThrow('neither a path');
	});
});

describe('parseCallMethod placeholders', () => {
	test('Fills {name} from the parameters, encoded, and leaves the rest for the query or body', () => {
		// Octokit's shape: the path takes its parameters, the others stay
		expect(
			parseCallMethod('GET /repos/{owner}/{repo}/issues', { owner: 'acme', repo: 'web app', state: 'open' }),
		).toStrictEqual({ verb: 'GET', target: '/repos/acme/web%20app/issues', params: { state: 'open' } });

		// A value cannot reshape the path, and a number is written as digits
		expect(parseCallMethod('GET /files/{id}', { id: '../admin?x=1' }).target).toBe('/files/..%2Fadmin%3Fx%3D1');
		expect(parseCallMethod('GET /items/{id}', { id: 42 }).target).toBe('/items/42');
	});

	test('Leaves a placeholder without a parameter for the driver, and refuses an object for one', () => {
		// `{bucket}` is the driver's to fill; the caller's parameters are not touched
		const params = { limit: 1 };

		expect(parseCallMethod('GET /b/{bucket}/o', params)).toStrictEqual({
			verb: 'GET',
			target: '/b/{bucket}/o',
			params: { limit: 1 },
		});

		expect(params).toStrictEqual({ limit: 1 });

		// A list or an object has no single place in a path
		expect(() => parseCallMethod('GET /items/{id}', { id: [1, 2] })).toThrow('must be a string or a number');
		expect(() => parseCallMethod('GET /items/{id}', { id: Symbol('s') })).toThrow('must be a string or a number');
	});

	test('Refuses a value that would move the request to another path, and ignores inherited names', () => {
		// `..` or `.` would climb the path once the URL collapses it; an empty one would hit the collection
		for (const id of ['..', '.', '']) {
			expect(() => parseCallMethod('DELETE /files/{id}', { id })).toThrow('cannot be empty, "." or ".."');
		}

		// A name only the prototype has is not a parameter: the placeholder stays for the driver
		expect(parseCallMethod('GET /x/{constructor}/{toString}', {}).target).toBe('/x/{constructor}/{toString}');
	});

	test('Fills the same placeholder twice with one parameter, and takes 0 and false as values', () => {
		// Repeated: both places filled, the parameter still sent once — not at all
		expect(parseCallMethod('GET /a/{id}/b/{id}', { id: 7, q: 1 })).toStrictEqual({
			verb: 'GET',
			target: '/a/7/b/7',
			params: { q: 1 },
		});

		// Falsy scalars are values
		expect(parseCallMethod('GET /page/{n}/{flag}', { n: 0, flag: false }).target).toBe('/page/0/false');
	});
});

describe('toHeaderRecord', () => {
	test('Lower-cases names from a Headers or a record, joining repeats and lists', () => {
		// A `Headers`, a header given twice
		const cookies = new Headers({ 'X-RateLimit-Remaining': '9' });

		cookies.append('Set-Cookie', 'a=1');
		cookies.append('Set-Cookie', 'b=2');

		expect(toHeaderRecord(cookies)).toStrictEqual({ 'x-ratelimit-remaining': '9', 'set-cookie': 'a=1, b=2' });

		// A record with a list, a number and a hole; nothing at all
		expect(toHeaderRecord({ 'Set-Cookie': ['a', 'b'], Age: 3, None: undefined })).toStrictEqual({
			'set-cookie': 'a, b',
			age: '3',
		});

		expect(toHeaderRecord(undefined)).toStrictEqual({});
	});
});
