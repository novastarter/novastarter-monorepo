---
'@novastarter/mail': patch
'@novastarter/release-notes-generator': patch
---

The `smtp` and `sendmail` mail drivers are tested in a file each like every other driver, and `@novastarter/release-notes-generator` declares `sideEffects: false` like every other package so bundlers can tree-shake it; nothing changes for consumers.
