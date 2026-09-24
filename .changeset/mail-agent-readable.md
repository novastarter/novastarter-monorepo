---
'@novastarter/mail': patch
'@novastarter/mail-driver-mailgun': minor
'@novastarter/mail-driver-mailjet': minor
'@novastarter/mail-driver-mailtrap': minor
'@novastarter/mail-driver-postmark': minor
'@novastarter/mail-driver-resend': minor
'@novastarter/mail-driver-sendgrid': minor
'@novastarter/mail-driver-ses': minor
---

Mail drivers no longer have a default export; import them by name, e.g. `import { MailDriverResend } from '@novastarter/mail-driver-resend'`.
