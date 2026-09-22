---
'@novastarter/payments-driver-paddle': patch
---

Invoice totals now carry the ISO 4217 currency in lower case (`usd`), as the kit's `Money` contract requires, instead of the upper case Paddle sends; webhook parsing verifies the signature once, through the SDK's `unmarshal`, and still answers a forged or malformed signature with the kit's invalid-credentials error.
