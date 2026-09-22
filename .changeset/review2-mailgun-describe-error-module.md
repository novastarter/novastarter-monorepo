---
'@novastarter/mail-driver-mailgun': patch
---

Mailgun driver: the SDK error wrapper lives in its own `describe-error` module with its own test now, the layout the other drivers of the kit use; calling code is unaffected.
