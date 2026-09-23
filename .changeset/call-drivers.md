---
'@novastarter/payments-driver-stripe': minor
'@novastarter/payments-driver-paddle': minor
'@novastarter/payments-driver-polar': minor
'@novastarter/payments-driver-lemonsqueezy': minor
'@novastarter/sms-driver-twilio': minor
'@novastarter/sms-driver-vonage': minor
'@novastarter/mail-driver-resend': minor
'@novastarter/mail-driver-postmark': minor
'@novastarter/mail-driver-sendgrid': minor
'@novastarter/mail-driver-mailgun': minor
'@novastarter/mail-driver-mailjet': minor
'@novastarter/mail-driver-mailtrap': minor
'@novastarter/mail-driver-ses': minor
'@novastarter/push-driver-fcm': minor
'@novastarter/storage-driver-s3': minor
'@novastarter/storage-driver-gcs': minor
'@novastarter/storage-driver-azure': minor
'@novastarter/storage-driver-cloudinary': minor
'@novastarter/storage-driver-supabase': minor
---

These drivers implement `call(method, params, options)`: any request of the provider's own API — `'POST /v1/refunds'`, a full URL on the provider's hosts, or an SDK command name for SES and S3 — with the location's credentials and timeout, errors as `ProviderCallError` or `HitRateLimitError`; each readme lists its endpoints and hosts.
