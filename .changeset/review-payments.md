---
'@novastarter/payments': patch
---

`handleWebhook` no longer loses the location line in the log when a payments driver rejects with a string or plain object instead of an Error; the rejection is logged as an Error with the original value as its cause.
