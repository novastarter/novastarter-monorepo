---
'@novastarter/database-driver-sqlite': patch
---

The SQLite driver leaves WAL off for files opened `readonly` by default — the attempt failed with `SQLITE_READONLY` — and closes the file handle when a pragma refuses, so a failed construction leaks nothing.
