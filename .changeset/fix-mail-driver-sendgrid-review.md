---
'@novastarter/mail-driver-sendgrid': patch
---

SendGrid driver no longer fails a send whose recipients repeat an address across `to`, `cc` and `bcc`; each address is sent once, in the first list it appears in.
