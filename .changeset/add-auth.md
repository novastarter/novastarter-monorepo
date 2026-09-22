---
'@novastarter/auth': minor
'@novastarter/auth-driver-credentials': minor
'@novastarter/auth-driver-github': minor
'@novastarter/auth-driver-google': minor
---

Add `@novastarter/auth`, a stateless authentication API — sign-in through the `AuthManager` of `useAuth()` (`signIn`, `startOAuth` / `finishOAuth` with state, PKCE and nonce in an encrypted cookie), sessions, scrypt passwords, one-time links and codes, JWT access tokens with rotating refresh tokens, TOTP with recovery codes — that returns records for the application to store in its own tables; plus one `@novastarter/auth-driver-*` package per sign-in method (credentials, Google, GitHub).
