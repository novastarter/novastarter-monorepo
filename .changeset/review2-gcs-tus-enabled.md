---
'@novastarter/storage-driver-gcs': patch
---

The GCS driver now honors `tus.enabled`: with `enabled: false` the chunked-upload methods (`createChunkedUpload`, `writeChunk`, `finishChunkedUpload`, `deleteChunkedUpload`) refuse with `The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)`; leave the flag unset or `true` to keep the previous behavior.
