---
'@novastarter/mail-driver-mailgun': patch
---

Mailgun driver now sends each attachment with its `contentType`, so an inline image named by a bare content id such as `logo` reaches mail clients as `image/png` instead of `application/octet-stream`.

Mailgun driver now gives sends and domain checks a 30 s timeout unless the location sets one, instead of waiting forever on a stalled connection.
