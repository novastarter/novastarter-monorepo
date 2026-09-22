---
'web': patch
---

The `web` app gets its database schema and migrations: `db/schema.ts` with a `users` table, `drizzle.config.ts` on the same variables the app boots from (PGlite without `DATABASE_URL`), the committed `drizzle/` folder, `pnpm --filter web db:generate` / `db:migrate` / `db:studio`, `useDb()` typed with the schema, and `DATABASE_MIGRATE=true` to apply pending migrations when the server starts.
