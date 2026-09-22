---
'@novastarter/push': patch
---

`sendPush()` now routes a message rewritten by a `push.send` handler by its own target and refuses a rewrite without a title or target, so a redirect from a subscription to a token reaches the token's location; a driver rejecting with a non-Error is logged as an Error with the location kept in the line.
