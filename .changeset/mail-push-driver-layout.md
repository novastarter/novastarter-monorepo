---
'@novastarter/mail': patch
'@novastarter/push': minor
'@novastarter/mail-driver-mailgun': minor
'@novastarter/mail-driver-mailjet': minor
'@novastarter/mail-driver-mailtrap': minor
'@novastarter/mail-driver-postmark': minor
'@novastarter/mail-driver-resend': minor
'@novastarter/mail-driver-sendgrid': minor
'@novastarter/mail-driver-ses': minor
'@novastarter/push-driver-apns': minor
'@novastarter/push-driver-fcm': minor
'@novastarter/push-driver-webpush': minor
---

`PushDriverConfig` is removed (use `LocationConfig<PushDrivers>` of `@novastarter/utils`) and the `mail-driver-*` / `push-driver-*` packages now export only the driver class, its `…Config` type and the default export — mapping helpers such as `toMailgunMessage`, `toFcmMessage` and `describeError` are internal; `MailDriver` still comes from `@novastarter/mail`.
