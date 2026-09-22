---
'@novastarter/payments-driver-lemonsqueezy': patch
---

Invoice totals now carry the ISO 4217 currency in lower case (`usd`), as the kit's `Money` contract requires, instead of the upper case Lemon Squeezy sends.
