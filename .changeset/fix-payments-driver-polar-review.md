---
'@novastarter/payments-driver-polar': patch
---

Polar driver: `createCheckoutSession` now sends `allowTrial: false` when no positive `trialDays` is given, so the product's own trial no longer applies to checkouts that should charge right away.
