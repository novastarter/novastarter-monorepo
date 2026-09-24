---
'@novastarter/sms': patch
'@novastarter/sms-driver-twilio': minor
'@novastarter/sms-driver-vonage': minor
'@novastarter/messenger': patch
'@novastarter/messenger-driver-telegram': minor
'@novastarter/notifications': patch
---

SMS and messenger drivers no longer have a default export; import them by name, e.g. `import { SmsDriverTwilio } from '@novastarter/sms-driver-twilio'`.
