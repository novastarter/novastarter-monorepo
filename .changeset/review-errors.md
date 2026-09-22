---
'@novastarter/errors': patch
---

`isNovastarterError(error, ErrorCode.InvalidPayload)` now types `error.extensions` as `InvalidPayloadErrorExtensions` instead of `never`, and the readme shows how to pass the extensions type for a custom code.
