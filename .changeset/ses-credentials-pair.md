---
'@novastarter/mail-driver-ses': patch
---

The SES driver now refuses a location that gives only one of `accessKeyId` and `secretAccessKey` instead of silently falling back to the SDK's credential chain, the way the S3 storage driver does.
