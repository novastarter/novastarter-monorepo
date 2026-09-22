---
'@novastarter/release-notes-generator': patch
---

A stable release right after a prerelease cycle is no longer reported as a prerelease: the prerelease tag is read from `.changeset/pre.json` only while `changesets` is in prerelease mode (`mode: "pre"`), since `changesets pre exit` keeps the file on disk with `mode: "exit"`.
