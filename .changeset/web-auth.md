---
'web': patch
---

The `web` app registers `@novastarter/auth` at bootstrap — the credentials driver on `users.password_hash`, Google and GitHub when their `AUTH_*` keys are set, and the sign-in, TOTP and code limiters — and stores sessions, one-time tokens, refresh tokens and TOTP enrolments in its own `auth_*` tables through the modules under `auth/`; production refuses to boot without `AUTH_JWT_SECRET`, `AUTH_MFA_ENCRYPTION_KEY` and `AUTH_OAUTH_SECRET`.
