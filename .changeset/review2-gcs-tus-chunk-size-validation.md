---
'@novastarter/storage-driver-gcs': patch
---

The GCS driver validates the `tus.chunkSize` value itself, so a configured `0` or `NaN` is refused at construction with `The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB` instead of being silently replaced by the default chunk size.
