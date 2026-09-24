---
'@novastarter/auth-driver-credentials': minor
'@novastarter/auth-driver-github': minor
'@novastarter/auth-driver-google': minor
'@novastarter/auth-driver-magic-link': minor
'@novastarter/auth-driver-passkey': minor
'@novastarter/auth': patch
---

Auth drivers no longer have a default export; import them by name, e.g. `import { AuthDriverGithub } from '@novastarter/auth-driver-github'`.
