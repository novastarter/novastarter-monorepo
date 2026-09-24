---
'@novastarter/auth-driver-credentials': minor
'@novastarter/auth-driver-github': minor
'@novastarter/auth-driver-google': minor
'@novastarter/auth-driver-magic-link': minor
'@novastarter/auth-driver-passkey': minor
---

A driver set up wrong (a missing option or callback, a bad `timeout`, or a passkey registration on a location with another driver) now throws `InvalidConfigError` instead of a plain `Error` or `RangeError`, so callers can match it by class or by the `INVALID_CONFIG` code.
