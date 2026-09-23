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
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai';
import { AiModelNotFoundError } from '../errors/model-not-found.js';

/**
 * A provider of the AI SDK, as its package builds it: `createOpenAI({ apiKey })`, `createAnthropic(…)`, `gateway`.
 */
export type AiProvider = ProviderV4 | ProviderV3;

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
	 * @param name - What model ids name it by: `openai` in `openai:gpt-5-mini`; must not contain a colon.
	 * @param provider - The provider, as its `@ai-sdk/*` package builds it.
	 * @throws Error when the name is empty or contains a colon, since no model id could name it.
	 */
	registerProvider(name: string, provider: AiProvider): void {
		// 1. The colon separates the provider from the model in an id, so a name holding one could never be reached
		if (name === '' || name.includes(':')) {
			throw new Error(`AI provider name "${name}" must be non-empty and must not contain ":"`);
		}

		// 2. Store it and drop the registry, so the next model is resolved against the new set of providers
		this.providers[name] = provider;
		this.built = undefined;
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
