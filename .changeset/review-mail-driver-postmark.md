---
'@novastarter/mail-driver-postmark': patch
---

Postmark driver no longer fails a send whose tags past the first exceed 80 characters joined: they are spread over the `tags`, `tags2`, … metadata fields within Postmark's limits.
