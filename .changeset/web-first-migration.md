---
'web': patch
---

The `web` app commits its first migration, `drizzle/0000_init.sql` creating the `users` table, and an integration test that applies the `drizzle/` folder to PGlite in memory, so `pnpm --filter web db:migrate` works on a fresh clone.
