/**
 * Tests of `config/ai`: a provider joins per key that is set, and each alias points at the first provider serving it.
 */
import { AiManager } from '@novastarter/ai';
import { describe, expect, test } from 'vitest';
import { envSchema } from '../env';
import { aiConfig } from './ai';

/**
 * The parsed variables the config reads, from raw overrides over the schema defaults.
 *
 * @param overrides - Raw variables over the defaults.
 * @returns The parsed variables.
 */
const env = (overrides: Record<string, string> = {}) => envSchema.parse({ NODE_ENV: 'test', ...overrides });

describe('aiConfig', () => {
	test('Registers nothing without a key', () => {
		// A fresh clone runs without AI: no provider, and no alias that would point at one
		expect(aiConfig(env())).toStrictEqual({ providers: {}, models: {} });
	});

	test('Registers a provider per key that is set', () => {
		// Every key brings its provider under the name the model ids use
		const config = aiConfig(
			env({
				AI_OPENAI_API_KEY: 'sk-openai',
				AI_ANTHROPIC_API_KEY: 'sk-anthropic',
				AI_GOOGLE_API_KEY: 'google',
				AI_GATEWAY_API_KEY: 'gateway',
			}),
		);

		expect(Object.keys(config.providers).sort()).toStrictEqual(['anthropic', 'gateway', 'google', 'openai']);
	});

	test('Points each alias at the first provider serving it', () => {
		// The gateway goes first when it is set
		expect(aiConfig(env({ AI_GATEWAY_API_KEY: 'gateway', AI_OPENAI_API_KEY: 'sk-openai' })).models).toStrictEqual({
			chat: 'gateway:openai/gpt-5.4-mini',
			embeddings: 'gateway:openai/text-embedding-3-small',
		});

		// Anthropic serves chat but no embeddings, so those go to the next provider that has them
		expect(aiConfig(env({ AI_ANTHROPIC_API_KEY: 'sk-anthropic', AI_GOOGLE_API_KEY: 'google' })).models).toStrictEqual({
			chat: 'anthropic:claude-sonnet-5',
			embeddings: 'google:gemini-embedding-001',
		});

		// With Anthropic alone, embeddings stay unset rather than pointing at a provider without a key
		expect(aiConfig(env({ AI_ANTHROPIC_API_KEY: 'sk-anthropic' })).models).toStrictEqual({
			chat: 'anthropic:claude-sonnet-5',
		});
	});

	test('Resolves every default alias through the real providers', () => {
		// Each provider set, each preference order tried: the providers only build model objects here, so no request
		// leaves the process, yet a wrong model kind or a provider without it would throw
		for (const key of ['AI_GATEWAY_API_KEY', 'AI_OPENAI_API_KEY', 'AI_ANTHROPIC_API_KEY', 'AI_GOOGLE_API_KEY']) {
			const config = aiConfig(env({ [key]: 'test-key' }));
			const manager = new AiManager();

			for (const [name, provider] of Object.entries(config.providers)) {
				manager.registerProvider(name, provider);
			}

			manager.registerModels(config.models);

			expect(manager.languageModel('chat').modelId).toBe(config.models['chat']!.split(':').slice(1).join(':'));

			if (config.models['embeddings']) {
				expect(manager.embeddingModel('embeddings').modelId).toBe(
					config.models['embeddings'].split(':').slice(1).join(':'),
				);
			}
		}
	});
});
