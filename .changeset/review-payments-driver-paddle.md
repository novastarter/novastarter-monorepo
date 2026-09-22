---
'@novastarter/payments-driver-paddle': patch
---

Paddle driver methods now document the `ApiError` they throw when Paddle refuses a request and the fetch error when it cannot be reached; the mapping tests moved next to their modules (no runtime change).
