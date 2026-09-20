---
'@novastarter/payments': minor
'@novastarter/errors': minor
'@novastarter/queue': minor
---

`definePlans`, `PlanCatalog` and `EntitlementManager` leave `@novastarter/payments` (which now depends on `@novastarter/utils` only), `LimitExceededError` and `ResourceRestrictedError` leave `@novastarter/errors`, and the `system.ping` contract, its handler, its development schedule and the internal-jobs delivery constants leave `@novastarter/queue` — `JobRegistry` starts empty, so an application declares every job it enqueues; the unused `@novastarter/stores` package is removed.
