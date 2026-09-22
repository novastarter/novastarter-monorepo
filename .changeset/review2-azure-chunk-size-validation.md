---
'@novastarter/storage-driver-azure': patch
---

The Azure driver refuses a `tus.chunkSize` of zero, a negative number or `NaN` at construction (`The azure storage driver got a "tus.chunkSize" below 1 byte`) instead of letting it through and failing every chunk afterwards.
