---
'web': patch
---

`readEnv()` parses the configuration once per process and answers with the same variables afterwards — `useEnv(options)` refuses options after its first call, so the app passes them exactly once; tests drop the parsed variables with `readEnv.reset()`, which reads the raw ones afresh as well.
