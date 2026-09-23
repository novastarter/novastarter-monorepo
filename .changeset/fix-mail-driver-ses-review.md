---
'@novastarter/mail-driver-ses': patch
---

The SES driver drops a tag whose sanitised name is already on the message (`welcome flow` next to `welcome_flow`, or a tag named `category`) instead of sending two tags of one name, which SES refuses.
