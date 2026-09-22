---
'@novastarter/env': patch
---

A `<NAME>_FILE` secret read from a mounted file no longer keeps the file's trailing newline, so a variable set inline and through its `_FILE` twin now yields the same value.
