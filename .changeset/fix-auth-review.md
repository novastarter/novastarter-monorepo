---
'@novastarter/auth': patch
---

Encrypted cookies and TOTP secrets now open only with the full 16-byte GCM tag; a payload with a truncated tag is refused as not in a known format.
