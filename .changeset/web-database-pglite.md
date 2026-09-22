---
'web': patch
---

The `web` app runs on PGlite in-process when `DATABASE_URL` is unset: the `default` database location is always registered, persisted under `DATABASE_PGLITE_DIR` (default `./data/pglite`, `memory://` for a throwaway database), and `@electric-sql/pglite` is kept out of the Next.js bundle.
