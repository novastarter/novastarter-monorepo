---
'@novastarter/release-notes-generator': patch
---

`@novastarter/release-notes-generator` drops the unused `@pnpm/logger` dependency and declares `@changesets/types` as a regular dependency, so its declarations resolve for consumers.
