import type {
	EmbeddingModelV4,
	ImageModelV4,
	LanguageModelV4,
	ProviderV3,
	ProviderV4,
	RerankingModelV4,
	SpeechModelV4,
	TranscriptionModelV4,
} from '@ai-sdk/provider';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai';
import { AiModelNotFoundError } from '../errors/model-not-found.js';
import { AiProviderNotFoundError } from '../errors/provider-not-found.js';

/**
 * A provider of the AI SDK, as its package builds it: `createOpenAI({ apiKey })`, `createAnthropic(…)`, `gateway`.
 */
export type AiProvider = ProviderV4 | ProviderV3;

/**
 * The HTTP API of a provider, for {@link AiManager.call}: an AI SDK provider does not expose its key or its base URL,
 * so the application hands them over again when it registers the provider.
 */
export interface AiProviderApi {
	/** The API's root: `https://api.openai.com`; a path in it (`https://api.example.com/v1`) is kept. */
	baseURL: string;
	/** Sent as `Authorization: Bearer <apiKey>`; a provider with another scheme takes its key through `headers`. */
	apiKey?: string | undefined;
	/**
	 * Headers sent with every call: `{ 'x-api-key': key, 'anthropic-version': '2023-06-01' }` for Anthropic,
	 * `{ 'x-goog-api-key': key }` for Google.
	 */
	headers?: Record<string, string> | undefined;
	/** How long a call may take, in milliseconds; 30 seconds unless given. */
	timeout?: number | undefined;
	/** The hosts a full URL in a call may point at, besides the base URL's own; `*.example.com` matches subdomains. */
	allowedHosts?: string[] | undefined;
}

/**
 * What {@link AiManager.registerProvider} takes besides the provider.
 */
export interface AiProviderOptions {
	/** The provider's HTTP API, for {@link AiManager.call}; without it the provider serves models only. */
	api?: AiProviderApi | undefined;
}

/**
 * A model id qualified with the name its provider is registered under: `openai:gpt-5-mini`.
 */
export type AiModelId = `${string}:${string}`;

/**
 * Registry of the AI providers of the process and the aliases of their models.
 *
 * The AI SDK is the driver layer already — every `@ai-sdk/*` package builds a provider the same way — so the manager
 * takes the provider as is rather than wrapping each vendor in a driver package: the application creates it from its
 * own configuration and registers it under a name. On top of that it keeps aliases (`chat`, `embeddings`) mapped to
 * `provider:model` ids, so the code asks for a role and the configuration decides which model plays it. A model is
 * resolved through `createProviderRegistry` of the AI SDK, built on first use and rebuilt after every registration.
 * The application wires it at start-up through {@link useAi}.
 *
 * @example
 * ```ts
 * const ai = new AiManager();
 *
 * ai.registerProvider('openai', createOpenAI({ apiKey: '…' }));
 * ai.registerModels({
 * 	chat: 'openai:gpt-5-mini',
 * });
 *
 * const { text } = await generateText({
 * 	model: ai.languageModel('chat'),
 * 	prompt: 'Hello',
 * });
 * ```
 */
export class AiManager {
	/**
	 * Providers by the name they were registered under.
	 *
	 * @internal
	 */
	private providers: Record<string, AiProvider> = {};

	/**
	 * The HTTP APIs of the providers registered with one, by provider name.
	 *
	 * @internal
	 */
	private apis: Record<string, AiProviderApi> = {};

	/**
	 * Aliases registered by the application, mapped to the model id each stands for.
	 *
	 * @internal
	 */
	private aliases: Record<string, AiModelId> = {};

	/**
	 * The AI SDK registry over {@link providers}; `undefined` until first use and after every registration.
	 *
	 * @internal
	 */
	private built: ProviderRegistryProvider | undefined;

	/**
	 * Register a provider under a name, replacing the one registered under it before.
	 *
	 * The replacement is whole: registering again without `options.api` drops the API registered before, so
	 * {@link call} never sends the old credentials along with a new provider.
	 *
	 * @param name - What model ids name it by: `openai` in `openai:gpt-5-mini`; must not contain a colon.
	 * @param provider - The provider, as its `@ai-sdk/*` package builds it.
	 * @param options - The provider's HTTP API, when the application wants {@link call} for it.
	 * @throws Error when the name is empty or contains a colon, since no model id could name it.
	 * @throws Error when `options.api.baseURL` is not an http(s) URL.
	 * @example
	 * ```ts
	 * ai.registerProvider('anthropic', createAnthropic({ apiKey: key }), {
	 * 	api: {
	 * 		baseURL: 'https://api.anthropic.com',
	 * 		headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
	 * 	},
	 * });
	 * ```
	 */
	registerProvider(name: string, provider: AiProvider, options: AiProviderOptions = {}): void {
		// 1. The colon separates the provider from the model in an id, so a name holding one could never be reached
		if (name === '' || name.includes(':')) {
			throw new Error(`AI provider name "${name}" must be non-empty and must not contain ":"`);
		}

		// 2. A base URL that does not parse would only fail on the first call, far from the configuration that set it;
		//    the URL itself stays out of the message, since a proxy URL may carry a key in its query
		const api = options.api;

		if (api !== undefined && !isHttpUrl(api.baseURL)) {
			throw new Error(`The API of AI provider "${name}" needs a "baseURL" that is an http(s) URL`);
		}

		// 3. Store it and drop the registry, so the next model is resolved against the new set of providers
		this.providers[name] = provider;
		this.built = undefined;

		// 4. The API copied, so a later change to the caller's object does not leak in; none drops the previous one
		if (api === undefined) {
			delete this.apis[name];
		} else {
			this.apis[name] = {
				...api,
				...(api.headers ? { headers: { ...api.headers } } : {}),
				...(api.allowedHosts ? { allowedHosts: [...api.allowedHosts] } : {}),
			};
		}
	}

	/**
	 * Register the aliases of the process, replacing the previous ones.
	 *
	 * The ids are not checked against the providers here: they are resolved on every lookup, so a provider registered
	 * after the aliases still serves them.
	 *
	 * @param models - Model id by alias: `{ chat: 'openai:gpt-5-mini', embeddings: 'openai:text-embedding-3-small' }`.
	 */
	registerModels(models: Record<string, AiModelId>): void {
		// 1. Replace rather than merge, like `registerRoutes` of the other managers: a second bootstrap gets exactly
		//    what it registered. Copied, so a later change to the caller's object does not leak in
		this.aliases = { ...models };
	}

	/**
	 * Tell whether a provider is registered under the name.
	 *
	 * @param name - Name of the provider.
	 * @returns `true` when {@link registerProvider} ran with this name.
	 */
	hasProvider(name: string): boolean {
		// 1. Own keys only, so a name like `toString` is not taken for a provider
		return Object.hasOwn(this.providers, name);
	}

	/**
	 * List the names of the registered providers.
	 *
	 * @returns The names, in registration order.
	 */
	providerNames(): string[] {
		// 1. A fresh array, so the caller cannot change the registry through it
		return Object.keys(this.providers);
	}

	/**
	 * Return the registered aliases.
	 *
	 * @returns Model id by alias; an empty object when none were registered.
	 */
	models(): Readonly<Record<string, AiModelId>> {
		// 1. A copy, so the caller cannot change the aliases behind the manager's back
		return { ...this.aliases };
	}

	/**
	 * Return the AI SDK registry over the registered providers, for what the helpers below do not cover.
	 *
	 * @returns The registry; the same one until the next {@link registerProvider}.
	 */
	registry(): ProviderRegistryProvider {
		// 1. Built lazily, once per set of providers, so registering several providers at start-up builds it once
		this.built ??= createProviderRegistry({ ...this.providers });

		return this.built;
	}

	/**
	 * Resolve a language model, for `generateText`, `streamText` and the other text functions of the AI SDK.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no such model.
	 */
	languageModel(model: string): LanguageModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().languageModel(this.resolve(model));
	}

	/**
	 * Resolve an embedding model, for `embed` and `embedMany`.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no embedding models.
	 */
	embeddingModel(model: string): EmbeddingModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().embeddingModel(this.resolve(model));
	}

	/**
	 * Resolve an image model, for `generateImage`.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no image models.
	 */
	imageModel(model: string): ImageModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().imageModel(this.resolve(model));
	}

	/**
	 * Resolve a transcription model, for `transcribe`.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no transcription models.
	 */
	transcriptionModel(model: string): TranscriptionModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().transcriptionModel(this.resolve(model));
	}

	/**
	 * Resolve a speech model, for `generateSpeech`.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no speech models.
	 */
	speechModel(model: string): SpeechModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().speechModel(this.resolve(model));
	}

	/**
	 * Resolve a reranking model, for `rerank`.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The model.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @throws NoSuchModelError of the AI SDK when the provider has no reranking models.
	 */
	rerankingModel(model: string): RerankingModelV4 {
		// 1. Resolve the name first, so a typo fails with the kit's error rather than the registry's
		return this.registry().rerankingModel(this.resolve(model));
	}

	/**
	 * Make a raw request to a provider's own HTTP API, with the credentials, timeout and hosts it was registered with.
	 *
	 * The escape hatch for what the AI SDK does not cover: listing models, files, batches, fine-tuning jobs. Only a
	 * provider registered with `options.api` can be called, since an AI SDK provider does not expose its key or base URL.
	 * The `apiKey` goes as `Authorization: Bearer`, the API's `headers` over it and the call's own headers on top.
	 *
	 * A `{name}` in the path is filled from the parameter of that name, URL-encoded — `GET /v1/files/{id}` with
	 * `{ id }` — and that parameter is not sent again.
	 *
	 * @typeParam T - What the provider answers; the caller knows it from the provider's documentation.
	 * @param provider - The name the provider was registered under.
	 * @param method - `'VERB /path'` from the API's base URL, or `'VERB https://host/path'` on the base URL's host or one
	 * of its `allowedHosts`.
	 * @param params - The query of a GET, HEAD or DELETE, the JSON body otherwise; multipart when a `Blob` is among them.
	 * @param options - A timeout over the API's, an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and the body: parsed JSON, else its text; `undefined` when empty.
	 * @throws AiProviderNotFoundError when no provider is registered under the name.
	 * @throws Error when the provider was registered without an API, the method is malformed, or a full URL points at a
	 * host of another party.
	 * @throws HitRateLimitError when the provider answers 429.
	 * @throws ProviderCallError when the provider answers any other error status.
	 * @throws TimeoutError when the call takes longer than the timeout.
	 * @example
	 * ```ts
	 * const { data } = await useAi().call<{ data: { id: string }[] }>('openai', 'GET /v1/models');
	 *
	 * const { headers } = await useAi().call('openai', 'GET /v1/files/{id}', { id: 'file-1' });
	 * ```
	 */
	async call<T = unknown>(
		provider: string,
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. The provider and its API first, so a typo or a missing API fails before any request is built
		if (!this.hasProvider(provider)) {
			throw new AiProviderNotFoundError({ provider });
		}

		const api = Object.hasOwn(this.apis, provider) ? this.apis[provider] : undefined;

		if (api === undefined) {
			throw new Error(
				`AI provider "${provider}" was registered without an API: call() needs ` +
					`registerProvider(name, provider, { api: { baseURL, … } })`,
			);
		}

		// 2. The registered API as `request()` takes it — the key as a bearer token, the API's headers over it, a
		//    provider with another scheme setting its own — and errors named after the registered provider.
		//    `request()` checks the URL against the hosts before the credentials are attached and keeps them out of
		//    every error
		const http: HttpApi = {
			provider,
			baseUrl: api.baseURL,
			hosts: api.allowedHosts,
			headers: { ...(api.apiKey ? { authorization: `Bearer ${api.apiKey}` } : {}), ...api.headers },
			timeout: api.timeout,
		};

		return request<T>(http, method, params, options);
	}

	/**
	 * Turn an alias or a model id into the id of a registered provider's model.
	 *
	 * @param model - An alias, or a `provider:model` id.
	 * @returns The `provider:model` id.
	 * @throws AiModelNotFoundError when the name is neither an alias nor an id of a registered provider.
	 * @internal
	 */
	private resolve(model: string): AiModelId {
		// 1. An alias wins over an id of the same spelling, so the configuration always has the last word
		const id = Object.hasOwn(this.aliases, model) ? this.aliases[model]! : model;

		// 2. The provider is everything before the first colon; the model id after it may hold colons of its own
		const separator = id.indexOf(':');

		if (separator <= 0 || separator === id.length - 1 || !this.hasProvider(id.slice(0, separator))) {
			throw new AiModelNotFoundError({ model });
		}

		return id as AiModelId;
	}
}

/**
 * Tell whether a string is an absolute http(s) URL.
 *
 * @param value - The string.
 * @returns `true` for an `http:` or `https:` URL that parses.
 * @internal
 */
const isHttpUrl = (value: string): boolean => {
	// 1. `new URL` throws on anything that is not an absolute URL; the protocol check keeps `file:` and the like out
	try {
		const { protocol } = new URL(value);

		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
};
