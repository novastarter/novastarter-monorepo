---
'web': minor
'docs': patch
---

Config mistakes (missing `MAIL_DRIVER`, `SMS_DRIVER` or auth secrets in production, broken plan definitions, a plan without a provider price id) now throw `InvalidConfigError`, and an unknown plan or an unsold period throws `InvalidPayloadError`.
