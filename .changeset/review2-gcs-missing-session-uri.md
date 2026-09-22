---
'@novastarter/storage-driver-gcs': patch
---

GCS `writeChunk` no longer hands the SDK `uri: undefined` when the upload context carries no session URI: it throws `Cannot write a chunk of "…": the context has no session uri`, the wording the S3 driver uses for its missing upload id.
