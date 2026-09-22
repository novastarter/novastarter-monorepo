---
'@novastarter/database': patch
'@novastarter/database-driver-postgres': patch
'@novastarter/database-driver-supabase': patch
'@novastarter/database-driver-neon': patch
'@novastarter/database-driver-mysql': patch
'@novastarter/database-driver-sqlite': patch
'@novastarter/database-driver-d1': patch
'@novastarter/database-driver-pglite': patch
'@novastarter/database-driver-turso': patch
---

The readmes of `@novastarter/database` and every driver document the `label` option, `capabilities.transactions`, the `DatabaseUnavailableError` thrown by `ping()` and the `resolveLogger` / `ensureDirectory` / `toUnavailableError` helpers a driver author builds on.
