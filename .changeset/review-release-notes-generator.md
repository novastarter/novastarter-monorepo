---
'@novastarter/release-notes-generator': minor
---

Notice blocks now end at the first `:::` line and are recognised in CRLF changesets, a notice-only changeset no longer prints a literal `**` title, and `run(changesets)` is exported so the release notes step can be driven without the `beforeExit` hook.
