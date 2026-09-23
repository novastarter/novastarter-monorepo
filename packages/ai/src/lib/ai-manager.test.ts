/**
 * Tests of `ai/lib/ai-manager`: providers and aliases registered, models resolved through the AI SDK registry.
 *
 * The providers are the mocks of `ai/test`, so nothing leaves the process.
 */
import { isNovastarterError } from '@novastarter/errors';
import { generateText } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import { describe, expect, test } from 'vitest';
import { AiModelNotFoundError } from '../errors/model-not-found.js';
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
