---
'@novastarter/database': minor
'@novastarter/utils': minor
'@novastarter/database-driver-postgres': minor
'@novastarter/database-driver-neon': minor
'@novastarter/database-driver-mysql': minor
'@novastarter/database-driver-turso': minor
---

Add `hasMethods(value, methods)` to `@novastarter/utils` and `ensureDirectory(path)` to `@novastarter/database`; the `isPool` exports of `database-driver-postgres`, `database-driver-neon`, `database-driver-mysql` and the `isClient` export of `database-driver-turso` are removed — use `hasMethods<Pool>(connection, ['connect', 'end'])` and the like instead.
