---
'@novastarter/mail': patch
'@novastarter/mail-driver-mailgun': patch
---

`formatMailAddress()` of `@novastarter/mail` now throws an `InvalidPayloadError` when a name, address or pre-formatted address string holds CR, LF or another control character instead of letting it forge a mail header, and the Mailgun driver refuses a custom header whose name is no token or whose value holds a line break before it reaches the API.
