---
'@novastarter/sms-driver-vonage': patch
---

The Vonage SMS driver now strips the leading `+` from a numeric sender the way it already does for the recipient, so a sender given in E.164 no longer fails with Vonage status 15; alphanumeric sender ids pass through unchanged.
