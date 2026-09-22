---
'@novastarter/release-notes-generator': patch
---

`processPackages()` now names the source of a missing or invalid main version — the `NOVASTARTER_VERSION` environment variable or the configured main package — instead of printing `'undefined' package`, and the package-order comparator sorts unlisted packages after listed ones from both comparison directions.
