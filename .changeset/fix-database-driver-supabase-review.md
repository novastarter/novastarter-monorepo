---
"@novastarter/database-driver-supabase": patch
---

The Supabase driver now refuses a `url` carrying an `ssl` query parameter, which node-postgres reads over the `ssl` option (`ssl=0` turned TLS off, `ssl=1` dropped the `ca`); set TLS with `ssl` and `ca` instead.
