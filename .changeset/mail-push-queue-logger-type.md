---
'@novastarter/mail': patch
'@novastarter/push': patch
'@novastarter/queue': patch
---

`@novastarter/mail`, `@novastarter/push` and `@novastarter/queue` take their `Logger` type from `@novastarter/logger`, so their declarations no longer require `pino` to be installed.
