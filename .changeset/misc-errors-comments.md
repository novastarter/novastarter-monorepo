---
'@novastarter/ai': minor
'@novastarter/feature-flags': minor
'@novastarter/messenger': minor
'@novastarter/messenger-driver-telegram': minor
'@novastarter/notifications': minor
'@novastarter/pressure': patch
---

Setup mistakes (a missing registration, a duplicate channel or flag, an unknown messenger location, a bad AI provider name or `baseURL`, a bad Telegram `token` or `apiUrl`) now throw `InvalidConfigError` (`INVALID_CONFIG`), and any other Telegram refusal throws `ProviderCallError` with its status and answer in `extensions`.
