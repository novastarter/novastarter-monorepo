---
'@novastarter/storage-driver-local': patch
---

A resumable (TUS) upload no longer empties a file already stored at its path: chunks go to a `<path>.<random>.tmp` staging file that replaces the target only when the upload finishes, so an abandoned, terminated or expired upload leaves the previous content in place.
