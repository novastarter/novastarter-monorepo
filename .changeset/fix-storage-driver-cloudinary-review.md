---
'@novastarter/storage-driver-cloudinary': patch
---

Cloudinary uploads now sign every chunk under a timestamp taken once the chunk is read, so writes, resumed TUS uploads and single TUS chunks that take longer than an hour no longer fail as stale; `write` pauses reading the source while the upload queue is full instead of buffering the whole stream in memory; and cancelling an unfinished TUS upload no longer deletes the asset already stored at that path, while terminating an upload whose final chunk was accepted still removes the asset it stored.
