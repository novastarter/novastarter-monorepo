---
'@novastarter/mail': minor
'@novastarter/mail-driver-mailgun': minor
'@novastarter/mail-driver-mailjet': minor
'@novastarter/mail-driver-mailtrap': minor
'@novastarter/mail-driver-postmark': minor
'@novastarter/mail-driver-resend': minor
'@novastarter/mail-driver-sendgrid': minor
'@novastarter/mail-driver-ses': minor
---

Add `@novastarter/mail` with the `MailManager` of `useMail()` — `registerDriver` / `registerLocation` / `registerRoutes` the application calls at start-up, the built-in `console`, `file`, `sendmail` and `smtp` drivers, `sendMail()` routing a message down a chain of locations with per-location rate limits — plus one `@novastarter/mail-driver-*` package per vendor (Amazon SES, SendGrid, Resend, Postmark, Mailtrap, Mailjet, Mailgun).
