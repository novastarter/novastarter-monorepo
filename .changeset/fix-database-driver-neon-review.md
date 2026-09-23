---
'@novastarter/database-driver-neon': patch
---

`DatabaseDriverNeonHttp.migrate()` now applies each pending migration together with its journal row in one Neon HTTP transaction, so a failing migration no longer leaves earlier migrations from the same run applied but unrecorded.

`DatabaseDriverNeonHttp.migrate()` runs its transactions as `READ WRITE` and `NOT DEFERRABLE`, so `options.readOnly` meant for `db.batch()` no longer blocks migrations. Statements Postgres refuses inside a transaction, such as `CREATE INDEX CONCURRENTLY`, are not supported in a Neon HTTP migration.
