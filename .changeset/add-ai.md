---
'@novastarter/ai': minor
---

Add `@novastarter/ai`, the Vercel AI SDK re-exported with an `AiManager` of `useAi()`: the application registers any `@ai-sdk/*` provider and the aliases of its models at start-up, and the code resolves them with `languageModel()`, `embeddingModel()` and the other lookups for `generateText`, `streamText`, `embed` and the rest.
