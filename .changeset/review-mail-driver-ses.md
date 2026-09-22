---
'@novastarter/mail-driver-ses': patch
---

SES driver now sanitises message tag names and values to SES's character set (`welcome flow` becomes `welcome_flow`, cut at 256 characters, empty tags dropped) instead of letting SES reject the whole message.
