---
'@novastarter/mail': patch
---

`formatMailAddress` now throws `InvalidPayloadError` when the address of a `{ name, address }` object holds whitespace or any of `, ; < > " ( )`, so one recipient can no longer be turned into several on the Resend, Postmark and Mailgun drivers.
