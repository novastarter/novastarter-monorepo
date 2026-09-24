---
'@novastarter/auth': minor
---

A missing or short secret, incomplete JWT settings and a location whose driver does not support the sign-in flow now throw `InvalidConfigError`, so callers can match them by the `INVALID_CONFIG` code instead of a plain `Error` message.
