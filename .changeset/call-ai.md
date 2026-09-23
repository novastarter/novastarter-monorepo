---
'@novastarter/ai': minor
---

`registerProvider(name, provider, { api: { baseURL, apiKey, headers } })` enables `useAi().call(name, method, params)` for any request of that provider's own API — models, files, token counts — outside the AI SDK, answering `{ status, headers, data }`; a provider registered without `api` refuses the call with an error naming the missing option, and an unknown one throws the new `AiProviderNotFoundError`.
