---
'@novastarter/mail-driver-mailtrap': patch
---

`MailDriverMailtrap.verify()` no longer always fails with a missing account id; it lists the token's accounts through Mailtrap's API directly and throws `ProviderCallError` when the token is refused.
