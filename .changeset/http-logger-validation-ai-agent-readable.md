---
'@novastarter/release-notes-generator': minor
'@novastarter/http': patch
'@novastarter/logger': patch
'@novastarter/validation': patch
'@novastarter/ai': patch
---

`@novastarter/release-notes-generator` no longer has a default export; changesets loads `getReleaseLine` and `getDependencyReleaseLine` by name, so no config change is needed.
