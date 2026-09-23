---
'@novastarter/storage-driver-supabase': patch
---

Resumable uploads now fail early with named errors instead of cryptic `tus-js-client` rejections: `writeChunk` refuses a deferred-length upload up front and treats an empty chunk as a no-op that returns the offset unchanged, and the constructor rejects a `tus.chunkSize` of zero, a negative number or `NaN` (`The supabase storage driver got a "tus.chunkSize" below 1 byte`).
