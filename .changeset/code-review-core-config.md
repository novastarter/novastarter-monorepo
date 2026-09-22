---
'@novastarter/validation': patch
'@novastarter/release-notes-generator': minor
'@novastarter/logger': patch
'@novastarter/env': patch
'@novastarter/utils': patch
---

`FailedValidationError` extensions for date range rules now carry the bound as the ISO string the caller passed instead of a `Date` rendered with the server's timezone, and the message now describes `starts_with` / `ends_with` failures (including the negated and case-insensitive forms) with the compared text instead of leaving only the generic sentence.

`release-notes-generator` no longer reads `GITHUB_OUTPUT`, `NOVASTARTER_VERSION` or `process.cwd()` itself: `run` now takes these deployment inputs as an options argument and `processPackages` takes the forced version and the workspace root as parameters, so calling code must pass at least `run(changesets, { workspaceRoot })`.

`LogsStream` raw mode now checks that each line is valid JSON before interpolating it into the published payload and swaps a foreign or corrupted chunk for the same fallback line the pretty modes use, so subscribers of the `logs` channel no longer receive a syntactically invalid message.

A `*_FILE` variable that cannot be read now reports the file path in the error even when the value carries a cast prefix (`array:./secret` reports `./secret`), matching the path that was actually attempted.

The `@novastarter/utils/node` entry point no longer re-exports the internal process-id memo `_cache`; consumers keep `processId`, and only the module's own tests can reset the memo.
