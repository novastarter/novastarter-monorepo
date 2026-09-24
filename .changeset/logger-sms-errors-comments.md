---
'@novastarter/logger': minor
'@novastarter/sms': minor
'@novastarter/sms-driver-twilio': minor
'@novastarter/sms-driver-vonage': minor
---

Configuration mistakes (missing credentials, unknown sms location, unknown `logsStream` level) now throw `InvalidConfigError`, a message without a sender and a file or unsupported content type in Twilio `call()` throw `InvalidPayloadError`, and the pretty logs stream no longer crashes on a line that parses to `null` or another non-object JSON value.
