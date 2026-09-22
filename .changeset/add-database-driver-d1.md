---
'@novastarter/database-driver-d1': minor
---

Add `DatabaseDriverD1`, a Cloudflare D1 driver for `@novastarter/database`: the app hands in its `D1Database` binding, `db` is Drizzle's `DrizzleD1Database`, `migrate()` applies drizzle-kit folders from a Node process holding the binding, and there is nothing to close.
