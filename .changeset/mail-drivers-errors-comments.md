---
'@novastarter/mail-driver-mailtrap': minor
'@novastarter/mail-driver-postmark': minor
'@novastarter/mail-driver-resend': minor
'@novastarter/mail-driver-sendgrid': minor
'@novastarter/mail-driver-ses': minor
---

A wrong driver setup now throws `InvalidConfigError` (code `INVALID_CONFIG`) and a message without a `from` address, or an SES `call()` with an unknown action or extra headers, throws `InvalidPayloadError` (code `INVALID_PAYLOAD`), so you can check the error by its code.
