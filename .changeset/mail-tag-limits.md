---
'@novastarter/mail': patch
'@novastarter/mail-driver-mailgun': patch
'@novastarter/mail-driver-resend': patch
'@novastarter/mail-driver-sendgrid': patch
---

Mailgun tags are cut to 128 characters and capped at 3 per message, SendGrid categories at 255 characters and 10 per message, and Resend drops a tag that sanitises to an empty name and caps the list at 75: a label past a provider's limits now trims the analytics instead of failing the whole send, the way the SES and Postmark drivers already handled theirs.
