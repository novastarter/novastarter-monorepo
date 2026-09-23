---
'@novastarter/mail-driver-mailjet': patch
---

Sends through the Mailjet SDK now time out after 30 seconds instead of waiting forever on a stalled connection, so `sendMail()` can fall back to the next location; the new `timeout` option (milliseconds) sets another for both sends and `call()`.
