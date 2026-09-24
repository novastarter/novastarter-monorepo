---
'@novastarter/logger': minor
'@novastarter/sms': minor
'@novastarter/sms-driver-twilio': minor
'@novastarter/sms-driver-vonage': minor
---

Configuration mistakes (missing credentials or sender, unknown sms location, unknown `logsStream` level) now throw `InvalidConfigError`, a file or unsupported content type in Twilio `call()` throws `InvalidPayloadError`, and the pretty logs stream no longer crashes on a line that parses to `null` or another non-object JSON value.
