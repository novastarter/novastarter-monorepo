---
'web': patch
---

The `web` app registers an AI provider at bootstrap for each of `AI_OPENAI_API_KEY`, `AI_ANTHROPIC_API_KEY`, `AI_GOOGLE_API_KEY` and `AI_GATEWAY_API_KEY` that is set, with `chat` and `embeddings` model aliases, so route handlers call `streamText({ model: useAi().languageModel('chat'), … })` from `@novastarter/ai`.
