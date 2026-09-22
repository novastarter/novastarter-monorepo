---
'@novastarter/sms': minor
'@novastarter/sms-driver-twilio': minor
'@novastarter/sms-driver-vonage': minor
---

Add `@novastarter/sms` with the `SmsManager` of `useSms()` — `registerDriver` / `registerLocation` / `registerRoutes` the application calls at start-up, the built-in `console` driver, `sendSms()` normalising the recipient to E.164 and routing a message down a chain of locations with per-location rate limits — plus one `@novastarter/sms-driver-*` package per vendor (Twilio, Vonage).
