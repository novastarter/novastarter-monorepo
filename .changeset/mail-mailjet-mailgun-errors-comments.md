---
'@novastarter/mail': minor
'@novastarter/mail-driver-mailjet': minor
'@novastarter/mail-driver-mailgun': minor
---

Missing driver options, an unknown or missing mail location and an inactive Mailgun domain now throw `InvalidConfigError`, a message without `from`, a bad attachment or header throws `InvalidPayloadError`, and `@novastarter/mail-driver-mailjet` now loads in Node.
