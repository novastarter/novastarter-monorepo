---
'web': patch
---

The `web` app registers a `default` mail location on the `console` driver and the `MAIL_FROM` sender at bootstrap, and declares the `mail.send` job under `jobs/` — contract, handler and its registration — so `enqueue('mail.send', …)` delivers through `@novastarter/mail` out of the box.
