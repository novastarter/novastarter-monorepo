---
'@novastarter/mail-driver-mailgun': patch
---

Mailgun driver now sends each attachment with its `contentType`, so an inline image named by a bare content id such as `logo` reaches mail clients as `image/png` instead of `application/octet-stream`.
