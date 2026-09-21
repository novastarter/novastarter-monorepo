---
'@novastarter/utils': minor
---

Add `sleep`, `retry`, `toNumber`, `tryParseJSON` and `joinPath` to the shared entry point: a promise pause with abort support, a retry loop with configurable pacing, jitter, `shouldRetry` and `onRetry` that refuses a `retries` budget that is not a whole number and caps every pause at 30 s by default and at what a timer can hold (`MAX_TIMER_DELAY`, which `sleep` refuses to exceed), a strict number cast that answers `undefined` instead of `NaN`, a `parseJSON` that falls back instead of throwing, and a platform-neutral `path.posix.join` for object keys and URL paths.
