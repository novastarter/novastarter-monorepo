---
'@novastarter/storage-driver-azure': patch
---

A resumable upload is staged in a separate `<name>.<id>.tmp` append blob and copied over the target only when it finishes, so an upload to a path that already holds a blob no longer fails on every chunk, and a terminated or abandoned upload leaves the existing blob intact.
