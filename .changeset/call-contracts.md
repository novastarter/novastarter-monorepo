---
'@novastarter/utils': minor
'@novastarter/http': minor
'@novastarter/errors': minor
'@novastarter/mail': minor
'@novastarter/sms': minor
'@novastarter/push': minor
'@novastarter/payments': minor
'@novastarter/storage': minor
'@novastarter/messenger': minor
'@novastarter/messenger-driver-telegram': minor
---

Driver contracts of mail, SMS, push, payments, storage and messenger gain an optional `call(method, params, options)` for any request of a provider's own API, answering `{ status, headers, data }`; the new `@novastarter/http`, on `@octokit/request`, gives the application `http('GET https://…', params, options)` for any URL and drivers `request(api, method, params, options)` with `{name}` placeholders, host checks, redirects that never carry keys to another host, one deadline and `ProviderCallError`/`HitRateLimitError` of `@novastarter/errors` — and a location takes headers and a timeout for every call in `registerLocation(name, { driver, options, call })` of `DriverManager` in `@novastarter/utils`; the `console` drivers log such a call.
