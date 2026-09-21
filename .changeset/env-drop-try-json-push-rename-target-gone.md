---
'@novastarter/env': patch
'@novastarter/push': patch
---

Internal cleanup with no API change: the unused `tryJson` helper of `@novastarter/env` is removed and the `PushTargetGoneError` module of `@novastarter/push` is renamed from `errors/push-target-gone` to `errors/target-gone`; keep importing from the package root.
