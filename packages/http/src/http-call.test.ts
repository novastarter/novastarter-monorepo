/**
 * Tests of `http/http-call`: the URL check, the query and the request of a driver's `call()`.
 */
import { TimeoutError } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { httpCall, resolveCallUrl, toQueryString } from './http-call.js';

describe('resolveCallUrl', () => {
	test('Joins a path to the root, keeping the root’s own path', () => {
		// 1. A trailing slash on the root does not double up
		expect(resolveCallUrl('https://api.stripe.com', '/v1/customers?limit=1').href).toBe(
			'https://api.stripe.com/v1/customers?limit=1',
		);

		expect(resolveCallUrl('https://api.cloudinary.com/v1_1/demo/', '/resources/image').href).toBe(
			'https://api.cloudinary.com/v1_1/demo/resources/image',
		);
	});

	test('Accepts a full URL on the root’s host or an allowed one, subdomains by wildcard', () => {
		// 1. The provider's other hosts
		expect(
			resolveCallUrl('https://api.stripe.com', 'https://files.stripe.com/v1/files', ['files.stripe.com']).host,
		).toBe('files.stripe.com');

		expect(resolveCallUrl('https://api.twilio.com', 'https://lookups.twilio.com/v2/x', ['*.twilio.com']).host).toBe(
			'lookups.twilio.com',
		);
	});

	test('Keeps a query of the base after the target’s own, and reads allowed hosts in any case', () => {
		// 1. An API version in the base survives, the target's own parameter wins
		expect(resolveCallUrl('https://x.openai.azure.com/openai?api-version=1', '/deployments?limit=2').href).toBe(
			'https://x.openai.azure.com/openai/deployments?limit=2&api-version=1',
		);

		// 2. A host listed in upper case still matches the lower-cased URL host
		expect(resolveCallUrl('https://api.x.com', 'https://files.x.com/a', ['FILES.X.COM']).host).toBe('files.x.com');
		expect(resolveCallUrl('https://api.x.com', 'https://a.cdn.x.com/a', ['*.CDN.x.com']).host).toBe('a.cdn.x.com');
	});

	test('Allows plain HTTP only on the base’s own host', () => {
		// 1. A stand-in base in tests may be HTTP; the provider's real hosts are never reached without TLS
		expect(resolveCallUrl('http://localhost:4010', 'http://localhost:4010/v1').href).toBe('http://localhost:4010/v1');

		expect(() => resolveCallUrl('http://localhost:4010', 'http://api.paddle.com/v1', ['api.paddle.com'])).toThrow(
			'not on a host of this provider',
		);
	});

	test('Refuses a path with a placeholder nobody filled', () => {
		// 1. It would reach the provider as `%7Bowner%7D`
		expect(() => resolveCallUrl('https://api.github.com', '/repos/{owner}/x')).toThrow(
			'The call path needs a "owner" parameter for its {owner} placeholder',
		);
	});

	test('Refuses a full URL on another host, or plain HTTP under an HTTPS root', () => {
		// 1. The credentials would go to someone else
		expect(() => resolveCallUrl('https://api.stripe.com', 'https://evil.example/v1', ['files.stripe.com'])).toThrow(
			'The call URL is not on a host of this provider: evil.example',
		);

		expect(() =>
			resolveCallUrl('https://api.twilio.com', 'https://twilio.com.evil.example/', ['*.twilio.com']),
		).toThrow();

		expect(() => resolveCallUrl('https://api.stripe.com', 'http://api.stripe.com/v1')).toThrow();
	});
});

describe('toQueryString', () => {
	test('Repeats lists, sends objects as JSON and leaves missing values out', () => {
		// 1. The shapes REST APIs read
		expect(toQueryString({ limit: 10, expand: ['a', 'b'], filter: { x: 1 }, none: undefined, empty: null })).toBe(
			'?limit=10&expand=a&expand=b&filter=%7B%22x%22%3A1%7D',
		);

		expect(toQueryString({})).toBe('');
	});
});

describe('httpCall', () => {
	/**
	 * The stubbed `fetch`.
	 */
	const fetchMock = vi.fn();

	afterEach(() => {
		fetchMock.mockReset();
	});

	/**
	 * The init of the first `fetch` call.
	 *
	 * @returns The URL and the init.
	 */
	const sent = (): [string, RequestInit & { headers: Record<string, string> }] => {
		// 1. As `fetch(url, init)` was called
		return fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
	};

	test('Sends the parameters of a GET in the query and parses a JSON answer', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"data":[1]}', { status: 200 }));

		// 1. The query is added to what the URL already carries
		await expect(
			httpCall({
				url: new URL('https://api.example/v1/items?a=1'),
				verb: 'GET',
				params: { limit: 2 },
				headers: { Authorization: 'Bearer k' },
				timeout: 1000,
				fetch: fetchMock,
			}),
		).resolves.toMatchObject({ status: 200, body: { data: [1] } });

		const [url, init] = sent();

		expect(url).toBe('https://api.example/v1/items?a=1&limit=2');
		expect(init.body).toBeUndefined();

		expect(init.headers).toStrictEqual({
			accept: 'application/json',
			'user-agent': 'novastarter',
			authorization: 'Bearer k',
		});
	});

	test('Sends JSON, a form, or multipart when a file is among the parameters', async () => {
		fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

		// 1. JSON by default, with its content type; an empty answer is nothing
		await expect(
			httpCall({
				url: new URL('https://api.example/x'),
				verb: 'POST',
				params: { a: 1 },
				timeout: 1000,
				fetch: fetchMock,
			}),
		).resolves.toMatchObject({ status: 204, body: undefined });

		expect(sent()[1].body).toBe('{"a":1}');
		expect(sent()[1].headers['content-type']).toBe('application/json');

		// 2. A form where the API wants one
		fetchMock.mockClear();

		await httpCall({
			url: new URL('https://api.example/x'),
			verb: 'POST',
			params: { To: '+1', Tags: ['a', 'b'] },
			bodyType: 'form',
			timeout: 1000,
			fetch: fetchMock,
		});

		expect(sent()[1].body).toBe('To=%2B1&Tags=a&Tags=b');
		expect(sent()[1].headers['content-type']).toBe('application/x-www-form-urlencoded');

		// 3. A file: multipart, a JSON type set by the driver dropped so `fetch` sets the boundary
		fetchMock.mockClear();

		await httpCall({
			url: new URL('https://api.example/x'),
			verb: 'POST',
			params: { file: new File(['x'], 'a.txt'), meta: { k: 1 } },
			headers: { 'Content-Type': 'application/json' },
			timeout: 1000,
			fetch: fetchMock,
		});

		const form = sent()[1].body as FormData;

		expect((form.get('file') as File).name).toBe('a.txt');
		expect(form.get('meta')).toBe('{"k":1}');
		expect(sent()[1].headers['content-type']).toBeUndefined();
	});

	test('Answers a text body as text, whatever the status', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<Error>NoSuchKey</Error>', { status: 404 }));

		// 1. The status is the driver's to judge
		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 1000, fetch: fetchMock }),
		).resolves.toMatchObject({ status: 404, body: '<Error>NoSuchKey</Error>' });
	});

	test('Gives up at the deadline, and when the caller aborts', async () => {
		// 1. A request that only ends when its signal aborts
		const hanging = (_url: string, init: { signal: AbortSignal }): Promise<Response> =>
			new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 5, fetch: hanging }),
		).rejects.toBeInstanceOf(TimeoutError);

		// 2. The caller's own signal
		const controller = new AbortController();

		const pending = httpCall({
			url: new URL('https://api.example/x'),
			verb: 'GET',
			timeout: 10_000,
			signal: controller.signal,
			fetch: hanging,
		});

		controller.abort(new Error('stop'));

		await expect(pending).rejects.toThrow('stop');
	});

	test('Follows a redirect on the same origin with the credentials, and one to another origin without them', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/v2/items' } }))
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example/f' } }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }));

		// 1. Three hops: the key is sent twice on the provider's host, and never to the CDN
		await expect(
			httpCall({
				url: new URL('https://api.example/v1/items'),
				verb: 'GET',
				headers: { 'x-api-key': 'SECRET' },
				timeout: 1000,
				fetch: fetchMock,
			}),
		).resolves.toMatchObject({ status: 200, body: 'ok' });

		const hops = fetchMock.mock.calls.map(([url, init]) => [url, init.headers, init.redirect]);

		expect(hops).toStrictEqual([
			[
				'https://api.example/v1/items',
				{ accept: 'application/json', 'user-agent': 'novastarter', 'x-api-key': 'SECRET' },
				'manual',
			],
			[
				'https://api.example/v2/items',
				{ accept: 'application/json', 'user-agent': 'novastarter', 'x-api-key': 'SECRET' },
				'manual',
			],
			['https://cdn.example/f', { accept: 'application/json' }, 'manual'],
		]);
	});

	test('Turns a 303 into a GET without a body, and stops after too many redirects', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: '/result' } }))
			.mockResolvedValueOnce(new Response('{"done":true}', { status: 200 }));

		// 1. The POST's body is not sent again
		await httpCall({
			url: new URL('https://api.example/x'),
			verb: 'POST',
			params: { a: 1 },
			timeout: 1000,
			fetch: fetchMock,
		});

		expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'GET' });
		expect(fetchMock.mock.calls[1]![1]).not.toHaveProperty('body');

		// 2. A loop ends in an error rather than forever
		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/again' } }));

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 1000, fetch: fetchMock }),
		).rejects.toThrow('redirected more than 5 times');
	});

	test('Keeps a HEAD as a HEAD across a 303', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: '/result' } }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));

		// 1. The redirected request must not become a GET, or the server may send a full body the caller never asked for
		await httpCall({
			url: new URL('https://api.example/x'),
			verb: 'HEAD',
			timeout: 1000,
			fetch: fetchMock,
		});

		// 2. The second hop repeats the HEAD, the way fetch and browsers follow a 303
		expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'HEAD' });
	});

	test('Repeats a list of files, one part each, and leaves null out', async () => {
		fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

		// 1. A list of files: one part each; `null` left out
		await httpCall({
			url: new URL('https://api.example/x'),
			verb: 'POST',
			params: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], note: null },
			timeout: 1000,
			fetch: fetchMock,
		});

		const form = sent()[1].body as FormData;

		expect(form.getAll('files').map((file) => (file as File).name)).toStrictEqual(['a.txt', 'b.txt']);
		expect(form.has('note')).toBe(false);
	});

	test('Keeps the deadline while the body is read', async () => {
		// 1. Headers arrive at once, the body never ends: the deadline still fires
		fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start: () => undefined }), { status: 200 }));

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 20, fetch: fetchMock }),
		).rejects.toBeInstanceOf(TimeoutError);
	});

	test('Lets the caller’s content type pick the body: a form, multipart, a vendor JSON type', async () => {
		fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

		/**
		 * Send one POST with the given content type and parameters.
		 *
		 * @param type - The caller's content type.
		 * @param params - The parameters.
		 * @returns The init `fetch` was called with.
		 */
		const post = async (type: string, params: Record<string, unknown>) => {
			// 1. A fresh call each time, read back from the stub
			fetchMock.mockClear();

			await httpCall({
				url: new URL('https://api.example/x'),
				verb: 'POST',
				params,
				headers: { 'Content-Type': type },
				timeout: 1000,
				fetch: fetchMock,
			});

			return sent()[1];
		};

		// 1. A form, whatever the driver's default
		expect((await post('application/x-www-form-urlencoded; charset=utf-8', { token: 't', hint: 'access' })).body).toBe(
			'token=t&hint=access',
		);

		// 2. Multipart without a file, the type left to `fetch` for its boundary
		const multipart = await post('multipart/form-data', { name: 'a' });

		expect(multipart.body).toBeInstanceOf(FormData);
		expect(multipart.headers['content-type']).toBeUndefined();

		// 3. A vendor JSON type is JSON, and stays the type sent
		const vendor = await post('application/vnd.api+json', { data: { type: 'x' } });

		expect(vendor.body).toBe('{"data":{"type":"x"}}');
		expect(vendor.headers['content-type']).toBe('application/vnd.api+json');
	});

	test('Refuses to follow a redirect to another origin with the body, or down to plain HTTP', async () => {
		// 1. A 307 keeps the method and the body: to another host that body would go to someone else
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://b.example/x' } }));

		await expect(
			httpCall({
				url: new URL('https://api.example/x'),
				verb: 'POST',
				params: { secret: 1 },
				timeout: 1000,
				fetch: fetchMock,
			}),
		).rejects.toThrow('redirected to another origin with its body: b.example');

		// 2. Down to plain HTTP on another host
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://b.example/x' } }));

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 1000, fetch: fetchMock }),
		).rejects.toThrow('redirected to another origin without TLS: b.example');
	});

	test('Keeps a scalar under a text type as text, and parses JSON under any type', async () => {
		// 1. A text answer that looks like a number stays text
		fetchMock.mockResolvedValueOnce(new Response('0012', { status: 200, headers: { 'content-type': 'text/plain' } }));

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 1000, fetch: fetchMock }),
		).resolves.toMatchObject({ body: '0012' });

		// 2. A vendor JSON type is parsed, and so is an object labelled as text
		fetchMock.mockResolvedValueOnce(
			new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/vnd.api+json' } }),
		);

		await expect(
			httpCall({ url: new URL('https://api.example/x'), verb: 'GET', timeout: 1000, fetch: fetchMock }),
		).resolves.toMatchObject({ body: { a: 1 } });
	});
});
