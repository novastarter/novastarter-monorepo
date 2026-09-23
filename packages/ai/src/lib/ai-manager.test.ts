/**
 * Tests of `ai/lib/ai-manager`: providers and aliases registered, models resolved through the AI SDK registry.
 *
 * The providers are the mocks of `ai/test` and `fetch` is stubbed for `call()`, so nothing leaves the process.
 */
import { HitRateLimitError, isNovastarterError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { generateText } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AiModelNotFoundError } from '../errors/model-not-found.js';
import { AiProviderNotFoundError } from '../errors/provider-not-found.js';
import { AiManager, type AiProvider } from './ai-manager.js';

/**
 * A mock provider serving the given models.
 *
 * The mock declares its methods as possibly `undefined`, which `exactOptionalPropertyTypes` tells apart from the
 * optional methods of the provider contract; a real `@ai-sdk/*` provider needs no such cast.
 *
 * @param models - What the mock serves, by kind and id.
 * @returns The mock, typed as a provider.
 */
const provider = (models?: ConstructorParameters<typeof MockProviderV4>[0]): AiProvider => {
	// 1. Only the type changes: the mock implements every method the registry calls
	return new MockProviderV4(models) as AiProvider;
};

/**
 * A language model answering every call with the given text.
 *
 * @param text - What the model answers.
 * @returns The mock model.
 */
const answering = (text: string): MockLanguageModelV4 => {
	// 1. The smallest result `generateText` accepts: one text part, a finish reason and empty usage
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: 'text', text }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: {
				inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
				outputTokens: { total: 1, text: undefined, reasoning: undefined },
			},
			warnings: [],
		},
	});
};

describe('AiManager', () => {
	test('Resolves a provider:model id to the provider model', () => {
		// 1. The id names the provider before the colon and its model after
		const model = answering('hi');
		const manager = new AiManager();

		manager.registerProvider('mock', provider({ languageModels: { small: model } }));

		expect(manager.languageModel('mock:small')).toBe(model);
	});

	test('Resolves an alias to the model it stands for', () => {
		// 1. The code asks for a role; the aliases decide which model plays it
		const chat = answering('hi');
		const embeddings = new MockEmbeddingModelV4();
		const manager = new AiManager();

		manager.registerProvider(
			'mock',
			provider({ languageModels: { small: chat }, embeddingModels: { vectors: embeddings } }),
		);

		manager.registerModels({ chat: 'mock:small', embeddings: 'mock:vectors' });

		expect(manager.languageModel('chat')).toBe(chat);
		expect(manager.embeddingModel('embeddings')).toBe(embeddings);
	});

	test('Keeps the colons of the model id after the provider name', () => {
		// 1. Only the first colon separates the provider: fine-tuned and versioned ids carry colons of their own
		const model = answering('hi');
		const manager = new AiManager();

		manager.registerProvider('mock', provider({ languageModels: { 'ft:small:v1': model } }));

		expect(manager.languageModel('mock:ft:small:v1')).toBe(model);
	});

	test('Throws AiModelNotFoundError for an unknown alias, a malformed id and an unregistered provider', () => {
		const manager = new AiManager();

		manager.registerProvider('mock', provider({ languageModels: { small: answering('hi') } }));

		// 1. Each is a configuration mistake the kit's error names, before the AI SDK registry is asked
		for (const name of ['chat', ':small', 'mock:', 'other:small']) {
			expect(() => manager.languageModel(name)).toThrow(AiModelNotFoundError);
		}

		// 2. An alias pointing at a provider that was never registered fails the same way, naming the alias
		manager.registerModels({ chat: 'other:small' });

		try {
			manager.languageModel('chat');
			expect.unreachable();
		} catch (error) {
			expect(isNovastarterError(error, 'AI_MODEL_NOT_FOUND')).toBe(true);
			expect((error as InstanceType<typeof AiModelNotFoundError>).extensions).toStrictEqual({ model: 'chat' });
		}
	});

	test('Refuses a provider name the ids could not reach', () => {
		const manager = new AiManager();

		// 1. The colon separates provider from model, so a name holding one, or an empty name, is refused
		expect(() => manager.registerProvider('', provider())).toThrow('must be non-empty');
		expect(() => manager.registerProvider('a:b', provider())).toThrow('must not contain ":"');
	});

	test('Refuses the name __proto__, which the plain records object could not hold', () => {
		const manager = new AiManager();

		// 1. `providers` and `apis` are plain object literals: `records['__proto__'] = …` invokes the Object.prototype
		//    setter and swaps the records' prototype instead of storing the provider, so nothing is registered
		expect(() => manager.registerProvider('__proto__', provider())).toThrow('must not be "__proto__"');

		expect(() =>
			manager.registerProvider('__proto__', provider(), { api: { baseURL: 'https://api.example.com' } }),
		).toThrow('must not be "__proto__"');

		// 2. Nothing was stored and no prototype was touched: the provider is absent from every lookup
		const records = (manager as unknown as { providers: object }).providers;

		expect(Object.getPrototypeOf(records)).toBe(Object.prototype);
		expect(manager.hasProvider('__proto__')).toBe(false);
		expect(manager.providerNames()).toStrictEqual([]);
		expect(() => manager.languageModel('__proto__:small')).toThrow(AiModelNotFoundError);
	});

	test('Rebuilds the registry after a provider is registered', () => {
		const first = answering('first');
		const second = answering('second');
		const manager = new AiManager();

		// 1. The registry is built once and kept while the providers stay the same
		manager.registerProvider('mock', provider({ languageModels: { small: first } }));

		const registry = manager.registry();

		expect(manager.registry()).toBe(registry);
		expect(manager.languageModel('mock:small')).toBe(first);

		// 2. A replacement under the same name is seen at once
		manager.registerProvider('mock', provider({ languageModels: { small: second } }));

		expect(manager.registry()).not.toBe(registry);
		expect(manager.languageModel('mock:small')).toBe(second);
	});

	test('Replaces the aliases on every registration and hands out copies', () => {
		const manager = new AiManager();
		const models = { chat: 'mock:small' } as const;

		// 1. A second registration replaces rather than merges, like a second bootstrap
		manager.registerModels(models);
		manager.registerModels({ smart: 'mock:large' });

		expect(manager.models()).toStrictEqual({ smart: 'mock:large' });

		// 2. What goes in and what comes out are copies, so neither side changes the other
		const out = manager.models() as Record<string, string>;

		out['smart'] = 'mock:other';

		expect(manager.models()).toStrictEqual({ smart: 'mock:large' });
	});

	test('Lists the registered providers', () => {
		const manager = new AiManager();

		// 1. Names in registration order; an inherited key is not a provider
		manager.registerProvider('openai', provider());
		manager.registerProvider('anthropic', provider());

		expect(manager.providerNames()).toStrictEqual(['openai', 'anthropic']);
		expect(manager.hasProvider('openai')).toBe(true);
		expect(manager.hasProvider('toString')).toBe(false);
	});

	test('Hands generateText a model that answers', async () => {
		const manager = new AiManager();

		// 1. End to end through the AI SDK: the resolved model is what `generateText` calls
		manager.registerProvider('mock', provider({ languageModels: { small: answering('Hello!') } }));
		manager.registerModels({ chat: 'mock:small' });

		const { text } = await generateText({ model: manager.languageModel('chat'), prompt: 'Hi' });

		expect(text).toBe('Hello!');
	});
});

/**
 * The key the `call()` tests register, looked for in every error message.
 */
const KEY = 'sk-secret-key-123';

/**
 * Stub the global `fetch` with one answer, and record the requests it gets.
 *
 * @param status - The HTTP status of the answer.
 * @param body - The answer's body: JSON for an object, as is for a string, none for `undefined`.
 * @param headers - The answer's headers.
 * @returns The mock, whose calls are the requests.
 */
const stubFetch = (status: number, body?: unknown, headers: Record<string, string> = {}): ReturnType<typeof vi.fn> => {
	// 1. A text body as is, anything else as JSON, none for `undefined`
	let text: string | null = null;

	if (typeof body === 'string') {
		text = body;
	} else if (body !== undefined) {
		text = JSON.stringify(body);
	}

	// 2. A fresh `Response` per request, since a body can be read only once
	const fetchMock = vi.fn(async () => new Response(text, { status, headers }));

	vi.stubGlobal('fetch', fetchMock);

	return fetchMock;
};

/**
 * The URL, method, headers and body of the request `fetch` got.
 *
 * @param fetchMock - The stub from {@link stubFetch}.
 * @param index - Which request.
 * @returns What was requested.
 */
const requestOf = (
	fetchMock: ReturnType<typeof vi.fn>,
	index = 0,
): { url: string; method: string; headers: Record<string, string>; body: unknown } => {
	// 1. `httpCall` calls `fetch(url, init)` with plain-object headers
	const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];

	return {
		url,
		method: init.method ?? 'GET',
		headers: init.headers as Record<string, string>,
		body: init.body,
	};
};

/**
 * Run a call expected to fail, and hand back its error.
 *
 * @param run - The call.
 * @returns What it threw.
 */
const failure = async (run: () => Promise<unknown>): Promise<Error> => {
	// 1. A call that succeeds is a failed test
	try {
		await run();
	} catch (error) {
		return error as Error;
	}

	throw new Error('The call was expected to fail');
};

describe('AiManager.call', () => {
	afterEach(() => {
		// 1. Every test stubs its own `fetch`
		vi.unstubAllGlobals();
	});

	test('Sends the apiKey as a bearer token and GET params in the query', async () => {
		const fetchMock = stubFetch(200, { data: [{ id: 'gpt-5-mini' }] });
		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. The path goes under the base URL, the params into the query, the answer comes back parsed
		const { data } = await manager.call('openai', 'GET /v1/models', { limit: 2 });

		expect(data).toStrictEqual({ data: [{ id: 'gpt-5-mini' }] });

		const request = requestOf(fetchMock);

		expect(request.url).toBe('https://api.openai.com/v1/models?limit=2');
		expect(request.method).toBe('GET');
		expect(request.headers['authorization']).toBe(`Bearer ${KEY}`);
		expect(request.body).toBeUndefined();
	});

	test('Sends the API headers instead of a bearer token, the call headers on top, POST params as JSON', async () => {
		const fetchMock = stubFetch(200, { input_tokens: 12 });
		const manager = new AiManager();

		manager.registerProvider('anthropic', provider(), {
			api: {
				baseURL: 'https://api.anthropic.com',
				headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
			},
		});

		// 1. The provider's own scheme, no Authorization header, and the caller's beta header added
		await manager.call(
			'anthropic',
			'POST /v1/messages/count_tokens',
			{ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hi' }] },
			{ headers: { 'anthropic-beta': 'x' } },
		);

		const request = requestOf(fetchMock);

		expect(request.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
		expect(request.method).toBe('POST');

		expect(request.headers).toMatchObject({
			'x-api-key': KEY,
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'x',
			'content-type': 'application/json',
		});

		expect(request.headers['authorization']).toBeUndefined();

		expect(JSON.parse(request.body as string)).toStrictEqual({
			model: 'claude-sonnet-5',
			messages: [{ role: 'user', content: 'Hi' }],
		});
	});

	test('Keeps the path of the base URL and answers undefined for an empty body', async () => {
		const fetchMock = stubFetch(204);
		const manager = new AiManager();

		manager.registerProvider('proxy', provider(), { api: { baseURL: 'https://gateway.example.com/openai/v1' } });

		// 1. A proxy's root path stays in front of the call's path; a 204 has nothing to parse
		await expect(manager.call('proxy', 'DELETE /files/file-1')).resolves.toMatchObject({
			status: 204,
			data: undefined,
		});

		expect(requestOf(fetchMock).url).toBe('https://gateway.example.com/openai/v1/files/file-1');
	});

	test('Allows a full URL on the base host or an allowed host, and refuses any other before a request', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		manager.registerProvider('openai', provider(), {
			api: { baseURL: 'https://api.openai.com', apiKey: KEY, allowedHosts: ['*.openai.example'] },
		});

		// 1. The base's host and a wildcard subdomain are the provider's own
		await manager.call('openai', 'GET https://api.openai.com/v1/models');
		await manager.call('openai', 'GET https://files.openai.example/v1/x');

		expect(fetchMock).toHaveBeenCalledTimes(2);

		// 2. Any other host would receive the key, so it is refused without a request
		const error = await failure(() => manager.call('openai', 'GET https://evil.example/steal'));

		expect(error.message).toContain('not on a host of this provider');
		expect(error.message).not.toContain(KEY);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('Refuses a malformed method before a request', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. An unknown verb or a relative path is ambiguous, so nothing is sent
		await expect(manager.call('openai', 'FETCH /v1/models')).rejects.toThrow('is not');
		await expect(manager.call('openai', 'GET v1/models')).rejects.toThrow('neither a path');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Turns an error status into ProviderCallError named after the registered provider', async () => {
		stubFetch(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });

		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. The provider's status and answer are kept; the key is not in the message
		const error = await failure(() => manager.call('openai', 'GET /v1/models'));

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('openai refused GET /v1/models: 401 Incorrect API key provided');
		expect(error.message).not.toContain(KEY);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toStrictEqual({
			provider: 'openai',
			method: 'GET /v1/models',
			status: 401,
			body: { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } },
		});
	});

	test('Turns a 429 into HitRateLimitError reset at Retry-After', async () => {
		stubFetch(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '20' });

		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. The caller may try again once the provider's wait is over
		const error = await failure(() => manager.call('openai', 'GET /v1/models'));

		expect(error).toBeInstanceOf(HitRateLimitError);

		const reset = (error as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime();

		expect(reset - Date.now()).toBeGreaterThan(15_000);
		expect(error.message).not.toContain(KEY);
	});

	test('Uses the call timeout over the API timeout', async () => {
		// 1. A `fetch` that answers only when aborted, so the deadline decides
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					}),
			),
		);

		const manager = new AiManager();

		manager.registerProvider('openai', provider(), {
			api: { baseURL: 'https://api.openai.com', apiKey: KEY, timeout: 60_000 },
		});

		// 2. The call's 20 ms wins over the API's minute
		const error = await failure(() => manager.call('openai', 'GET /v1/models', {}, { timeout: 20 }));

		expect(error).toBeInstanceOf(TimeoutError);
		expect(error.message).not.toContain(KEY);
	});

	test('Throws AiProviderNotFoundError for a provider never registered', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		// 1. A typo in the name fails with the package's error, before any request
		const error = await failure(() => manager.call('openai', 'GET /v1/models'));

		expect(error).toBeInstanceOf(AiProviderNotFoundError);
		expect(isNovastarterError(error, 'AI_PROVIDER_NOT_FOUND')).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Refuses a provider registered without an API, and drops the API when registered again without one', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		// 1. Without an API there is no base URL or key to call with
		manager.registerProvider('openai', provider());

		await expect(manager.call('openai', 'GET /v1/models')).rejects.toThrow(
			'call() needs registerProvider(name, provider, { api: { baseURL, … } })',
		);

		// 2. A replacement without an API does not keep the old one's credentials
		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });
		manager.registerProvider('openai', provider());

		const error = await failure(() => manager.call('openai', 'GET /v1/models'));

		expect(error.message).toContain('registered without an API');
		expect(error.message).not.toContain(KEY);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Refuses an API whose baseURL is not an http(s) URL, without quoting it', () => {
		const manager = new AiManager();

		// 1. A bad base URL fails at start-up rather than on the first call; the URL may carry a key, so it is not quoted
		expect(() =>
			manager.registerProvider('openai', provider(), { api: { baseURL: `api.openai.com?k=${KEY}` } }),
		).toThrow('needs a "baseURL" that is an http(s) URL');

		expect(() => manager.registerProvider('openai', provider(), { api: { baseURL: 'file:///etc/passwd' } })).toThrow(
			'http(s) URL',
		);

		expect(manager.hasProvider('openai')).toBe(false);
	});

	test('Copies the API, so a later change to the caller object does not leak in', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();
		const api = { baseURL: 'https://api.openai.com', headers: { 'x-api-key': KEY } };

		// 1. The headers changed after registration are not the ones sent
		manager.registerProvider('openai', provider(), { api });
		api.headers['x-api-key'] = 'changed';

		await manager.call('openai', 'GET /v1/models');

		expect(requestOf(fetchMock).headers['x-api-key']).toBe(KEY);
	});
});

describe('AiManager.call placeholders and answers', () => {
	afterEach(() => {
		// 1. Every test stubs its own `fetch`
		vi.unstubAllGlobals();
	});

	test('Fills a {name} from its parameter, encoded, and sends that parameter nowhere else', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. A GET: the placeholder takes `id`, URL-encoded; the other parameters stay in the query
		await manager.call('openai', 'GET /v1/files/{id}', { id: 'a/b', limit: 5 });
		expect(requestOf(fetchMock).url).toBe('https://api.openai.com/v1/files/a%2Fb?limit=5');

		// 2. A POST: the placeholder's parameter is not in the body
		await manager.call('openai', 'POST /v1/batches/{id}/cancel', { id: 'batch_1', reason: 'x' });
		expect(requestOf(fetchMock, 1).url).toBe('https://api.openai.com/v1/batches/batch_1/cancel');
		expect(requestOf(fetchMock, 1).body).toBe('{"reason":"x"}');
	});

	test('Refuses a placeholder no parameter fills before any request', async () => {
		const fetchMock = stubFetch(200, {});
		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. Sent, it would reach the provider as `%7Bid%7D`
		await expect(manager.call('openai', 'GET /v1/files/{id}')).rejects.toThrow(/"id" parameter/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers the status, the lower-cased headers and the body', async () => {
		stubFetch(200, { ok: true }, { 'X-Request-Id': 'req_1' });

		const manager = new AiManager();

		manager.registerProvider('openai', provider(), { api: { baseURL: 'https://api.openai.com', apiKey: KEY } });

		// 1. Status, headers and body, typed as a `CallResponse`
		const answer = await manager.call<{ ok: boolean }>('openai', 'GET /v1/models');

		expect(answer.status).toBe(200);
		expect(answer.headers['x-request-id']).toBe('req_1');
		expect(answer.data).toStrictEqual({ ok: true });
	});
});
