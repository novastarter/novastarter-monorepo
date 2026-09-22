---
'web': patch
---

`readEnv()` parses the configuration once per process and answers with the same variables afterwards — `useEnv(options)` refuses options after its first call, so the app passes them exactly once; tests drop the parsed variables with `readEnv.reset()`, which reads the raw ones afresh as well. `shutdown()` closes every manager even when one refuses — reporting the refusal afterwards — and leaves the process not booted, so a later `bootstrap()` registers the locations again on a fresh Redis client instead of being a no-op over the client it quit; the job handlers stay registered across that.
