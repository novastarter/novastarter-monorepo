---
'@novastarter/storage-driver-cloudinary': patch
---

Chunked uploads no longer crash with a TypeError when the client sends no `Upload-Metadata`, `writeChunk` refuses a chunk above the size configured as `tus.chunkSize`, and `move`, `write`'s chunk uploads and `delete` release the connection they held by cancelling the unread response body; the search API request encodes the prefix, and an error body that is not JSON reads as `Unknown` instead of crashing the parse.
