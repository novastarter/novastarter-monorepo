---
"@novastarter/database-driver-supabase": patch
---

The Supabase driver now refuses a `url` carrying any TLS parameter node-postgres reads from the connection string (`sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation`, alongside `sslmode`), and a whitespace-only `ca` now counts as absent instead of replacing Node's root store.
