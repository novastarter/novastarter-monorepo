---
'@novastarter/mail-driver-sendgrid': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/mail-driver-postmark': patch
---

The SendGrid, Mailtrap and Postmark drivers translate the message before the API call now, so a failure of the message mapper (a missing `from` address, an unreadable attachment) raises the mapper's own error unchanged instead of a double-prefixed `SendGrid: SendGrid needs a "from" address`-style line.
