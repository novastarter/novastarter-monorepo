---
'@novastarter/utils': patch
---

The shared entry point is type-checked without `@types/node` again — the tests no longer pull it in — so `@novastarter/utils` keeps working in a browser bundle without a Node global slipping into a release.
