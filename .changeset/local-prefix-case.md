---
'@novastarter/storage-driver-local': patch
---

`list()` matches the prefix case-sensitively, exactly like the S3 driver, so `list('IMG')` no longer returns `img.png` on case-sensitive filesystems.
