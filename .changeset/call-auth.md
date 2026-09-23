---
'@novastarter/auth': minor
'@novastarter/auth-driver-github': minor
'@novastarter/auth-driver-google': minor
---

`finishOAuth()` now returns the provider's `tokens` (access, refresh, expiry, scope) next to the identity — kept out of the `auth.sign-in` filter and events, and yours to store encrypted — and the GitHub and Google drivers implement `call(method, params, { accessToken })` for any request of their APIs on behalf of the user, or with the app's own credentials without a token.
