---
'@novastarter/auth': minor
'@novastarter/auth-driver-magic-link': minor
'@novastarter/auth-driver-passkey': minor
---

Add two-step sign-in: `startChallenge()` / `finishChallenge()` of `@novastarter/auth`, with the state sealed in a cookie under the new `challenge.secret` setting, and two drivers on it — `@novastarter/auth-driver-magic-link` (a link or a six-digit code by mail) and `@novastarter/auth-driver-passkey` (WebAuthn sign-in and `startPasskeyRegistration()` / `finishPasskeyRegistration()` to add a key).
