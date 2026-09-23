---
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
---

The cloudinary driver refuses a `tus.chunkSize` of zero or `NaN` at construction instead of keeping it as the per-chunk bound (which refused every chunk or silently disabled the limit), and the azure driver's `call()` signs its short-lived account SAS with read, delete, list and tag permissions only — never write or create — so a signed URL that leaks can no longer modify the account.
