---
'@novastarter/mail-driver-resend': patch
---

Resend driver now base64-encodes attachment content and reads a local `path` itself instead of handing Resend raw text or a file path it cannot fetch, and a refused send throws with Resend's error value as the `cause`.
