---
'web': patch
---

The `web` app boots the kit from its own configuration: `env.ts` parses the variables with a zod schema, `config/*.ts` declare the logger, Redis, memory, queue and storage locations, `bootstrap.ts` registers them on the managers once per process and `instrumentation.ts` runs it when the Node.js server starts.
