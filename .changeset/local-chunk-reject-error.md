---
'@novastarter/storage-driver-local': patch
---

`writeChunk` now rejects with a real `Error` naming the file and offset, the failed write logged as before and carried as the error's `cause`, instead of rejecting with `undefined`.
