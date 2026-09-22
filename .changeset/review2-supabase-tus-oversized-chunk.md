---
'@novastarter/storage-driver-supabase': patch
---

Resumable uploads through the Supabase driver no longer drop the tail of an oversized chunk or crash `tus-js-client` with a TypeError: `writeChunk` refuses a chunk larger than `tus.chunkSize` before the upload starts with `The chunk of <n> bytes exceeds the chunk size limit of <m> bytes`, the same error the other drivers use.
