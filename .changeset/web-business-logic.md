---
'web': patch
---

The `web` app takes over the business logic cut out of the packages: the plan catalog, the entitlement gate and its two errors under `billing/`, and the `system.ping` job with its development schedule and the internal-jobs delivery constants under `jobs/`; the bootstrap registers the ping handler next to `mail.send`.
