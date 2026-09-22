---
'@novastarter/storage-driver-gcs': minor
---

GCS driver `write(path, stream, type)` now records the given MIME type as the object's Content-Type, `list()` no longer yields folder placeholder names ending in `/`, and chunked uploads no longer fail with a TypeError when the client sends no `Upload-Metadata`.
