---
'@novastarter/storage-driver-azure': patch
---

A resumable upload is staged in a separate `<name>.<id>.tmp` append blob and copied over the target only when it finishes, so an upload to a path that already holds a blob no longer fails on every chunk, and a terminated or abandoned upload leaves the existing blob intact.

Fix `copy()` and `move()` failing with 409 `InvalidBlobType` when the target exists as another blob type, such as a TUS-uploaded append blob and a block blob from `write()`: the target is now replaced.
