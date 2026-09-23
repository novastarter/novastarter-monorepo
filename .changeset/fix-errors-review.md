---
'@novastarter/errors': patch
---

`isNovastarterError(error, ErrorCode.ProviderCallFailed)` now types `error.extensions` as `ProviderCallErrorExtensions` instead of `never`, so reading `status` or `body` compiles.
