---
'web': patch
---

Each `config/*.ts` of the `web` app now describes one location and `bootstrap.ts` registers it by name with a single `registerLocation` call, so a new location is one entry in the config and one line in the bootstrap rather than a loop over a record.
