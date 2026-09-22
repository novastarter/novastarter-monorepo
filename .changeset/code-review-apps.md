---
'web': patch
'docs': patch
---

The landing page logo renders again in both apps — `next/image` rejects a relative `src` without a leading slash, so the theme image sources are now rooted paths.

The `web` app no longer hard-wires the `console` driver for mail and SMS: `MAIL_DRIVER` and `SMS_DRIVER` select the driver of the `default` location (console stays the default outside production), and a production boot without them fails loudly instead of logging verification links and one-time codes while delivering nothing; an entitlement key registered as both a limit and a switch no longer evicts its own cache entries, because the switch state caches in a slot of its own; the migration script keeps the failing SQL statement as its exit reason even when the shutdown also refuses to close; `./uploads`, where the default storage location writes, is git-ignored; and the bootstrap documentation no longer claims every location connects lazily, since the shared Redis client connects at boot.
