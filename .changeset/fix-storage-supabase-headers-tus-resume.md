---
'@novastarter/storage-driver-supabase': patch
'@novastarter/storage': patch
---

`read()` of the Supabase driver sends the service-role key in the `apikey` header next to the bearer token, the way the storage-js client is authenticated; `write()` without a type stores `application/octet-stream` instead of an empty `Content-Type`; resumable uploads record the creation date that resuming reads, and `writeChunk` accepts the standardised `contentType` metadata key with `type` as the legacy fallback. `@novastarter/storage`: docstring typo in `toRelativePath` fixed.
