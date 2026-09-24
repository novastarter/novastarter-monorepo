---
'@novastarter/payments-driver-paddle': minor
'@novastarter/payments-driver-polar': minor
'@novastarter/release-notes-generator': patch
---

A missing key, webhook secret or Paddle checkout page now throws `InvalidConfigError` (`INVALID_CONFIG`), and `updateSubscription()` with neither a price nor a quantity throws `InvalidPayloadError` (`INVALID_PAYLOAD`) instead of a plain `Error`, so callers can match on the class or the code.
