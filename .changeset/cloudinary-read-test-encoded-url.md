---
'@novastarter/storage-driver-cloudinary': patch
---

No runtime change: the `read` tests no longer fail at random when the generated path carries a reserved character such as `+`.
