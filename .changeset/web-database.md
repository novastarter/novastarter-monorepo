---
'web': patch
---

The `web` app registers the `postgres` and `supabase` database drivers at bootstrap and a `default` location from `DATABASE_URL` (driver chosen by `DATABASE_DRIVER`, Supabase certificate by `DATABASE_SSL_CA`); without `DATABASE_URL` no database location exists, and `shutdown()` closes the pool.
