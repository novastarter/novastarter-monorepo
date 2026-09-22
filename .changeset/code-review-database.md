---
'@novastarter/database': minor
'@novastarter/database-driver-supabase': patch
'@novastarter/database-driver-d1': patch
'@novastarter/database-driver-mysql': patch
'@novastarter/database-driver-sqlite': patch
'@novastarter/database-driver-turso': patch
'@novastarter/database-driver-postgres': patch
'@novastarter/database-driver-neon': patch
'@novastarter/database-driver-pglite': patch
---

`@novastarter/database`: the query log now carries the parameter count instead of the parameter values by default — the values can hold passwords and PII the logger's redaction cannot reach — with the values available again as `queryLogging: { params: true }`, and `DatabaseDriver` is exported type-only now, so importing it as a value fails at compile time instead of crashing Node at module load.

`@novastarter/database-driver-supabase`: a blank `ca` now counts as absent instead of replacing Node's default root store with an empty one, and a `url` carrying an `sslmode` parameter is refused up front because node-postgres would otherwise let it silently override the `ssl` option.

`@novastarter/database-driver-d1`, `@novastarter/database-driver-mysql`, `@novastarter/database-driver-sqlite` and `@novastarter/database-driver-turso`: `@novastarter/logger` is a devDependency now — nothing in these drivers imported it at runtime, so it no longer installs alongside the package; nothing changes for consumers.

`@novastarter/database-driver-postgres`, `@novastarter/database-driver-neon` and `@novastarter/database-driver-pglite`: the service-gated integration tests create their own fixture tables and guard their teardown, so each test passes run alone under `vitest -t` and a failing setup no longer hides its cause; nothing changes for consumers.
