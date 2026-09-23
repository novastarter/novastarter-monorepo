---
'@novastarter/utils': minor
'@novastarter/errors': minor
'@novastarter/mail': minor
'@novastarter/sms': minor
'@novastarter/push': minor
'@novastarter/payments': minor
'@novastarter/storage': minor
'@novastarter/messenger': minor
'@novastarter/messenger-driver-telegram': minor
---

Driver contracts of mail, SMS, push, payments, storage and messenger gain an optional `call(method, params, options)` for any request of a provider's own API, built on the new `parseCallMethod`/`CallOptions` (`timeout`, `signal`, `headers`, `paramsIn`) of `@novastarter/utils`, `httpCall`/`resolveCallUrl` of `@novastarter/utils/node` (keys stay on the provider's hosts, redirects included) and `ProviderCallError`/`toProviderCallError` of `@novastarter/errors`; the `console` drivers log such a call, and Telegram's `call()` now takes `options` (timeout, signal, headers).
