---
'@novastarter/storage-driver-s3': minor
'@novastarter/mail-driver-ses': minor
---

`StorageDriverS3` and `MailDriverSes` now implement `close()`, destroying the AWS SDK client so its keep-alive connections no longer hold the process open after the manager's `close()`.
