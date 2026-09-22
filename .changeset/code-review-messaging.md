---
'@novastarter/sms-driver-vonage': patch
'@novastarter/mail-driver-resend': patch
'@novastarter/mail-driver-ses': patch
'@novastarter/mail-driver-mailgun': patch
'@novastarter/mail-driver-postmark': patch
'@novastarter/mail-driver-mailtrap': patch
'@novastarter/sms-driver-twilio': patch
'@novastarter/push-driver-apns': major
'@novastarter/push-driver-fcm': patch
'@novastarter/push': patch
---

`SmsDriverVonage.verify()` now sends the credentials as a Basic `Authorization` header instead of `?api_key=…&api_secret=…` query parameters, so the account's secret no longer leaks into proxy, trace or error logs wherever the balance read is observed.

Resend tags are cut to the provider's 256-character name limit, SES message tags are capped at the provider's per-message count (the category taking one slot), Mailgun tags are brought into the provider's ASCII character set before the length cut, and Postmark drops empty tags before the first becomes `Tag` or joins the `tags` metadata — a label past a provider's limit trims the analytics instead of failing the whole send, everywhere.

The Mailtrap driver cuts the comma-joined tags until the `custom_variables` payload fits Mailtrap's limit instead of sending a value Mailtrap drops.

`SmsDriverTwilio` only reports `segments` when Twilio actually answers a count (`numSegments: null` or `''` no longer shows up as `segments: 0`), and `close()` no longer throws for a custom or mocked client without an axios `httpsAgent`, so shutting down releases every location.

`PushDriverApns` no longer implements `verify()`: after the constructor validated the signing key it could only re-check the same string, so it reported "verified" for ids APNs never saw — drop any `verify()` call, since a wrong team id, key id or topic still surfaces as `InvalidProviderToken` or `TopicDisallowed` on the first push.

`@novastarter/push-driver-fcm`'s error mapping tests now assert the malformed-token branch of `describeError` (`PushTargetGoneError` with the code as the reason), not a property every branch sets; `@novastarter/push`'s `usePush` singleton tests live in `use-push.test.ts` next to the module, the way the mail and SMS packages arrange theirs — nothing changes for consumers of either package.
