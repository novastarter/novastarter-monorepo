---
'@novastarter/constants': patch
'@novastarter/emitter': patch
'@novastarter/env': patch
'@novastarter/errors': patch
'@novastarter/logger': patch
'@novastarter/mail': patch
'@novastarter/mail-driver-mailgun': patch
'@novastarter/mail-driver-mailjet': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/mail-driver-postmark': patch
'@novastarter/mail-driver-resend': patch
'@novastarter/mail-driver-sendgrid': patch
'@novastarter/mail-driver-ses': patch
'@novastarter/memory': patch
'@novastarter/payments': patch
'@novastarter/payments-driver-lemonsqueezy': patch
'@novastarter/payments-driver-paddle': patch
'@novastarter/payments-driver-polar': patch
'@novastarter/payments-driver-stripe': patch
'@novastarter/pressure': patch
'@novastarter/push': patch
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
'@novastarter/push-driver-webpush': patch
'@novastarter/queue': patch
'@novastarter/redis': patch
'@novastarter/release-notes-generator': patch
'@novastarter/storage': patch
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-supabase': patch
'@novastarter/types': patch
'@novastarter/utils': patch
'@novastarter/validation': patch
---

Every package declares `sideEffects: false`, the same `build` / `dev` / `check-types` / `test` / `test:coverage` scripts and the same devDependency set, so bundlers can tree-shake them and `pnpm test` covers `@novastarter/constants` and `@novastarter/types` too.
