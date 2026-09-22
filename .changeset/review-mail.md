---
'@novastarter/mail': patch
---

`formatMailAddress` quotes display names with commas or other RFC 5322 specials so API drivers no longer split them into invalid recipients, the smtp driver lets nodemailer pair `secure` with port 465, the file driver keeps a `Message-ID` with `/` or `..` inside its directory, a route made only of unknown names falls through to the next rule, and `sendMail({ location })` with an unregistered name throws `Mail location "x" doesn't exist.` up front instead of logging a delivery failure.
