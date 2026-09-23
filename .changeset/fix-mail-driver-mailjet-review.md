---
'@novastarter/mail-driver-mailjet': patch
---

Sends through the Mailjet SDK now time out after 30 seconds instead of waiting forever on a stalled connection, so `sendMail()` can fall back to the next location; the new `timeout` option (milliseconds) sets another for both sends and `call()`.

Mailjet driver's `call()` now returns 64-bit ids such as a message `ID` as strings with their exact digits, the way `send()` does, instead of numbers rounded by `JSON.parse`.
