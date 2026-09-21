---
'@novastarter/mail-driver-mailgun': patch
'@novastarter/mail-driver-mailjet': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/mail-driver-postmark': patch
'@novastarter/mail-driver-resend': patch
'@novastarter/mail-driver-sendgrid': patch
'@novastarter/mail-driver-ses': patch
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-webpush': patch
---

The driver packages keep their default export in `index.ts` only; `import Driver from '@novastarter/<package>'` is unchanged.
