# `@novastarter/ai`

AI models for Novastarter, on top of the [Vercel AI SDK](https://ai-sdk.dev).

## Installation

```
pnpm add @novastarter/ai @ai-sdk/openai
```

Plus one `@ai-sdk/*` package per provider the app uses: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`,
`@ai-sdk/gateway` or any other provider of the AI SDK.

## Usage

At start-up, once — each provider as its package builds it, then the aliases of the models the code asks for; `env` is
the app's typed configuration.

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { useAi } from '@novastarter/ai';
import { env } from './env';

useAi().registerProvider('openai', createOpenAI({ apiKey: env.AI_OPENAI_API_KEY }));
useAi().registerProvider('anthropic', createAnthropic({ apiKey: env.AI_ANTHROPIC_API_KEY }));

useAi().registerModels({
	chat: 'openai:gpt-5.4-mini',
	smart: 'anthropic:claude-sonnet-5',
	embeddings: 'openai:text-embedding-3-small',
});
```

Anywhere later — the AI SDK is re-exported as is, so `generateText`, `streamText`, `embed`, `tool`, `Output` and the
rest come from the same import:

```ts
import { embed, generateText, streamText, useAi } from '@novastarter/ai';

const { text } = await generateText({
	model: useAi().languageModel('chat'),
	prompt: 'Write a haiku about TypeScript',
});

const { embedding } = await embed({
	model: useAi().embeddingModel('embeddings'),
	value: 'sunny day at the beach',
});
```

In a Next.js route handler, streaming to `useChat` of `@ai-sdk/react`:

```ts
import { convertToModelMessages, streamText, useAi, type UIMessage } from '@novastarter/ai';

export const POST = async (request: Request): Promise<Response> => {
	const { messages }: { messages: UIMessage[] } = await request.json();

	const result = streamText({
		model: useAi().languageModel('chat'),
		messages: await convertToModelMessages(messages),
	});

	return result.toUIMessageStreamResponse();
};
```

## Providers

The AI SDK is the driver layer already, so there are no `ai-driver-*` packages: `registerProvider(name, provider)` takes
any provider of the AI SDK as is. The name is what model ids start with — `openai` in `openai:gpt-5.4-mini` — and must
not contain a colon. Registering under a taken name replaces the provider.

`hasProvider(name)` and `providerNames()` tell what is registered; `registry()` hands out the AI SDK registry over the
providers, for what the helpers below do not cover.

## Models

Every lookup takes an alias or a `provider:model` id:

| Method                      | For                          |
| --------------------------- | ---------------------------- |
| `languageModel(model)`      | `generateText`, `streamText` |
| `embeddingModel(model)`     | `embed`, `embedMany`         |
| `imageModel(model)`         | `generateImage`              |
| `transcriptionModel(model)` | `transcribe`                 |
| `speechModel(model)`        | `generateSpeech`             |
| `rerankingModel(model)`     | `rerank`                     |

`registerModels()` replaces the aliases; an alias wins over an id of the same spelling. A name that is neither an alias
nor an id of a registered provider throws `AiModelNotFoundError` (`AI_MODEL_NOT_FOUND`); a provider without such a model
throws `NoSuchModelError` of the AI SDK.

In tests, register the mocks of `ai/test` (`MockProviderV4`, `MockLanguageModelV4`) instead of a real provider.
