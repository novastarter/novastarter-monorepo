---
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-local': patch
---

Azure `writeChunk` now enforces the chunk size limit while the chunk is still streaming instead of after buffering it whole, so an oversized chunk can no longer exhaust memory first. Cloudinary `write` accepts the contract's optional content type (Cloudinary derives the content type from the file extension and offers no upload parameter to override it, so the value is documented as ignored), sends no request for an empty write or empty TUS chunk instead of the rejected `Content-Range: bytes 0--1/0`, reports the first of several failed chunk uploads rather than the last, and builds public ids and asset folders without platform-dependent path parsing. GCS `writeChunk` omits `contentLength` when the upload size is unknown instead of sending `0`, which would finalise the object empty. Local `list` yields forward-slash paths on every platform, and its `tusExtensions` documentation now matches the other drivers.
