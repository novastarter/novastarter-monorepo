---
'@novastarter/errors': minor
---

`InvalidConfigError` (`INVALID_CONFIG`, 500) reports a driver, manager or location set up wrong, with a reason that names the subject and the fix: `new InvalidConfigError({ reason: 'The mysql database driver needs a "connection"' })`.
