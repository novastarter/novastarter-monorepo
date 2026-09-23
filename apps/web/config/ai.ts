import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { AiModelId, AiProvider } from '@novastarter/ai';
import type { AppEnv } from '../env';

/**
 * The AI configuration of the app: a provider per key that is set, and the aliases of the models the code asks for.
 */
export interface AiConfig {
	/** Provider by the name model ids use: `openai`, `anthropic`, `google`, `gateway`. */
	providers: Record<string, AiProvider>;
	/** Model id by alias: `chat`, `embeddings`. */
	models: Record<string, AiModelId>;
}

/**
 * Model of each alias by provider, in the order a provider is picked for it: the first registered one that serves
 * the alias wins. Anthropic has no embedding models, so `embeddings` skips it.
 *
 * @internal
 */
const DEFAULT_MODELS: Record<string, Record<string, AiModelId>> = {
	chat: {
		gateway: 'gateway:openai/gpt-5.4-mini',
		openai: 'openai:gpt-5.4-mini',
		anthropic: 'anthropic:claude-sonnet-5',
		google: 'google:gemini-3.5-flash',
	},
	embeddings: {
		gateway: 'gateway:openai/text-embedding-3-small',
		openai: 'openai:text-embedding-3-small',
		google: 'google:gemini-embedding-001',
	},
};

/**
 * The AI providers and model aliases.
 *
 * Each provider joins when its key is set, so a fresh clone runs with none of them; any other `@ai-sdk/*` provider is
 * one more entry here. An alias points at the first registered provider that serves it, and is left out when none
 * does — asking for it then fails with `AiModelNotFoundError` rather than calling a provider without a key.
 *
 * @param env - The app's variables.
 * @returns The configuration to register.
 */
export const aiConfig = (env: AppEnv): AiConfig => {
	// 1. A provider per key that is set; the keys are passed explicitly, since the provider packages would otherwise
	//    read their own variables behind the app's schema
	const providers: Record<string, AiProvider> = {};

	if (env.AI_GATEWAY_API_KEY) {
		providers['gateway'] = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
	}

	if (env.AI_OPENAI_API_KEY) {
		providers['openai'] = createOpenAI({ apiKey: env.AI_OPENAI_API_KEY });
	}

	if (env.AI_ANTHROPIC_API_KEY) {
		providers['anthropic'] = createAnthropic({ apiKey: env.AI_ANTHROPIC_API_KEY });
	}

	if (env.AI_GOOGLE_API_KEY) {
		providers['google'] = createGoogleGenerativeAI({ apiKey: env.AI_GOOGLE_API_KEY });
	}

	// 2. Each alias takes the model of the first registered provider that serves it
	const models: Record<string, AiModelId> = {};

	for (const [alias, candidates] of Object.entries(DEFAULT_MODELS)) {
		const provider = Object.keys(candidates).find((name) => name in providers);

		if (provider) {
			models[alias] = candidates[provider]!;
		}
	}

	return { providers, models };
};
