---
'@novastarter/env': minor
'@novastarter/http': minor
'@novastarter/errors': patch
---

`useEnv()` now throws `InvalidConfigError` (`INVALID_CONFIG`) for a broken config file or variable, and `call()`/`http()` throw `InvalidPayloadError` (`INVALID_PAYLOAD`) for a path placeholder left unfilled or filled with a bad value, so callers can match on the code instead of a plain `Error` message.
