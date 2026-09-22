---
'@novastarter/database-driver-turso': minor
---

Add `DatabaseDriverTurso`, a libSQL driver for `@novastarter/database` on `@libsql/client`: a local `file:` or `:memory:` database, a remote Turso database over `libsql://`, or an embedded replica with `syncUrl`, exposing Drizzle's `LibSQLDatabase` with `db.batch()` and `db.transaction()`, `migrate()` over drizzle-kit folders and `close()` for a client of its own.
