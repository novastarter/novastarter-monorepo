---
'@novastarter/database': patch
'@novastarter/database-driver-supabase': patch
'@novastarter/database-driver-pglite': patch
'@novastarter/database-driver-turso': patch
---

The `transactions` capability no longer reads as implying prepared statements — Supabase's transaction pooler (port 6543) rejects `.prepare(name)`, which Drizzle's relational query builder needs, while plain transactions work; the PGlite driver no longer calls `mkdirSync('')` on a pathless `file://` URL so PGlite's own clearer error surfaces, and the Turso driver answers no local path for a `file://` URL with a remote host instead of creating a bogus directory libsql would never open.
