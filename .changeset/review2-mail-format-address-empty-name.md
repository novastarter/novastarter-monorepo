---
'@novastarter/mail': patch
---

`formatMailAddress` trims the display name and answers the bare address when the name is empty or whitespace only, so a formatted line never carries a stray leading space.
