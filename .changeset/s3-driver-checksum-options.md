---
'@novastarter/storage-driver-s3': minor
---

Add `requestChecksumCalculation` and `responseChecksumValidation` options to `DriverS3Config`; set both to `WHEN_REQUIRED` for S3-compatible services without flexible checksums such as Cloudflare R2, which otherwise reject uploads made with `@aws-sdk/client-s3` 3.729.0 or newer.
