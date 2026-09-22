---
'@novastarter/mail': minor
'@novastarter/mail-driver-mailjet': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/mail-driver-sendgrid': patch
---

Add `parseMailAddress()` to `@novastarter/mail`, splitting a `MailAddress` into its name and address: the Mailjet, Mailtrap and SendGrid drivers now keep the display name of a `'Name <address>'` string instead of dropping it, so one message renders the same sender and recipients on every driver.
