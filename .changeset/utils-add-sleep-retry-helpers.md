---
'@novastarter/utils': minor
---

Add `sleep`, `retry`, `toNumber`, `tryParseJSON` and `joinPath` to the shared entry point: a promise pause with abort support, a retry loop with configurable pacing, jitter, `shouldRetry` and `onRetry`, a strict number cast that answers `undefined` instead of `NaN`, a `parseJSON` that falls back instead of throwing, and a platform-neutral `path.posix.join` for object keys and URL paths.
