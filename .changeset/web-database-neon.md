---
'web': patch
---

The `web` app registers the `neon` and `neon-http` database drivers next to `postgres` and `supabase`, `DATABASE_DRIVER` accepts `neon` (WebSocket pool) and `neon-http` (one fetch per query, no transactions), and the `default` location's `db` is typed as Drizzle's `PgDatabase`, common to every Postgres driver the app ships.
