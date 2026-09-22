---
'@novastarter/mail-driver-mailtrap': patch
---

Mailtrap driver no longer casts the already-numeric `testInboxId` through `Number()` when building the SDK client; no behavior change.
