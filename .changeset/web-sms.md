---
'web': patch
---

The `web` app registers a `default` SMS location on the `console` driver and the `SMS_FROM` sender at bootstrap, and declares the `sms.send` job under `jobs/` — contract, handler and its registration — so `enqueue('sms.send', …)` delivers through `@novastarter/sms` out of the box.
