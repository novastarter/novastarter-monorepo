---
'@novastarter/release-notes-generator': patch
---

`release-notes-generator` prints the error and exits with code 1 when the release notes run fails inside the `beforeExit` hook instead of dying on an unhandled rejection, and the `GITHUB_OUTPUT` heredoc for the notes uses a delimiter random per run so a crafted changeset summary can no longer end the block early and inject extra step outputs.
