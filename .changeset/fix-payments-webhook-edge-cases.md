---
'@novastarter/payments': patch
'@novastarter/payments-driver-paddle': patch
'@novastarter/payments-driver-polar': patch
'@novastarter/payments-driver-lemonsqueezy': patch
'@novastarter/payments-driver-stripe': patch
---

Payments webhook edge cases: the Paddle driver verifies webhook signatures in constant time before the SDK parses the body, answers 400 for a malformed `paddle-signature` header instead of 401, and drops a retried `subscription.updated` carrying the canceled status so it cannot resurrect a deleted subscription; JSDoc now documents throw cases, the Lemon Squeezy variant read behind subscription webhook events and its `canceledAt` approximation, and the Paddle SDK's five-second replay window that rejects valid deliveries from clocks running behind.
