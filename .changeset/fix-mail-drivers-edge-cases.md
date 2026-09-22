---
'@novastarter/mail-driver-ses': patch
'@novastarter/mail-driver-mailjet': patch
'@novastarter/mail-driver-resend': patch
'@novastarter/mail-driver-mailtrap': patch
---

SES no longer calls a nodemailer `close()` that does not exist on its transport, Mailjet caps the joined tags at its `CustomID` limit instead of letting an over-long value fail the send and keeps the response body as the `cause` of a refusal error, Resend describes failure values shaped otherwise than `{ name, message }`, and the Resend and Mailtrap drivers document why `MailResult.response` stays empty.
