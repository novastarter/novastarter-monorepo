---
'@novastarter/storage-driver-gcs': minor
'@novastarter/storage-driver-azure': minor
---

A driver set up wrong (missing bucket or credentials, a bad `tus.chunkSize`, chunked uploads on a GCS location with `tus.enabled: false`) now throws `InvalidConfigError` (`INVALID_CONFIG`), and an Azure chunk above the size limit throws `InvalidPayloadError` (`INVALID_PAYLOAD`), instead of a plain `Error`.
