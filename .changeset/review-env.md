---
'@novastarter/env': patch
---

`createEnv`/`useEnv` now refuse a `fileVariables` name set both as `<NAME>` and `<NAME>_FILE` instead of picking one by environment order, and a `_FILE` that cannot be read fails with the fs error quoted in the message and kept as `cause`; keep only one of the pair in your deployment.
