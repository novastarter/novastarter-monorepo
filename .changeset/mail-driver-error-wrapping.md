---
'@novastarter/mail-driver-mailjet': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/mail-driver-postmark': patch
'@novastarter/mail-driver-sendgrid': patch
'@novastarter/mail-driver-ses': patch
---

The Mailjet, Mailtrap, Postmark, SendGrid and SES drivers now wrap SDK and transport errors with the provider's name and the original error as `cause`, matching Mailgun, Resend and the push drivers, so a failing location's log line always says which provider refused.
