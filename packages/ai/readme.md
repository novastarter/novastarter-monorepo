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

`registerProvider(name, provider, { api })` also takes the provider's HTTP API, for [`call()`](#any-other-request);
registering again without `api` drops the one registered before.

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

## Any other request

`call(provider, method, params?, options?)` makes a raw request to a provider's own HTTP API — listing models, files,
batches, anything the AI SDK does not cover. An AI SDK provider does not expose its key or base URL, so the provider has
to be registered with `api`:

| Field          | What it is                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- |
| `baseURL`      | The API's root; a path in it is kept in front of every call's path                           |
| `apiKey`       | Sent as `Authorization: Bearer <apiKey>`                                                     |
| `headers`      | Sent with every call, over the bearer token: the key of a provider with another scheme       |
| `timeout`      | Milliseconds a call may take; 30 seconds unless given                                        |
| `allowedHosts` | Hosts a full URL may point at besides the base URL's own; `*.example.com` matches subdomains |

```ts
useAi().registerProvider('openai', createOpenAI({ apiKey: env.AI_OPENAI_API_KEY }), {
	api: { baseURL: 'https://api.openai.com', apiKey: env.AI_OPENAI_API_KEY },
});

// Anthropic takes its key in `x-api-key`, with the API version; Google in `{ 'x-goog-api-key': key }`
useAi().registerProvider('anthropic', createAnthropic({ apiKey: env.AI_ANTHROPIC_API_KEY }), {
	api: {
		baseURL: 'https://api.anthropic.com',
		headers: { 'x-api-key': env.AI_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
	},
});

const { data } = await useAi().call<{ data: { id: string }[] }>('openai', 'GET /v1/models');

const { data: count } = await useAi().call<{ input_tokens: number }>('anthropic', 'POST /v1/messages/count_tokens', {
	model: 'claude-sonnet-5',
	messages: [{ role: 'user', content: 'Hello' }],
});
```

A `{name}` in the path takes the parameter of that name, URL-encoded, and that parameter is not sent again. Every call
answers `{ status, headers, data }` — here with OpenAI's rate-limit header:

```ts
const { data: file, headers } = await useAi().call('openai', 'GET /v1/files/{id}', { id: 'file-abc123' });

console.log(headers['x-ratelimit-remaining-requests'], file);
```

`method` is `'VERB /path'` from `baseURL`, or `'VERB https://host/path'` — a full URL only on the base URL's host or one
of `allowedHosts`, so the key never reaches another party. `params` go in the query of a GET, HEAD or DELETE and as the
JSON body otherwise (multipart when a `Blob` is among them). `options` takes a `timeout` over the API's, a `signal` and
extra `headers`. `data` is the body parsed as JSON, else its text, `undefined` when empty.

A 429 throws `HitRateLimitError`; any other error status throws `ProviderCallError` with the provider's `status` and
`body` in `extensions`. An unknown provider throws `AiProviderNotFoundError` (`AI_PROVIDER_NOT_FOUND`); a provider
registered without `api` throws an `Error`.
