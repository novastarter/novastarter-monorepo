---
'@novastarter/database-driver-neon': minor
---

Add `@novastarter/database-driver-neon` with two drivers for `@novastarter/database` on `@neondatabase/serverless`: `DatabaseDriverNeon` (`neon`), a WebSocket pool with sessions and transactions ended by `close()`, and `DatabaseDriverNeonHttp` (`neon-http`), one fetch per query with no transactions and nothing to close; both expose Drizzle's Neon databases and `migrate()` over drizzle-kit folders.
