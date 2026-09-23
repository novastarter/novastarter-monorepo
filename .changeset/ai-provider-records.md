---
'@novastarter/ai': patch
---

`AiManager.registerProvider` now rejects the provider name `__proto__`, which previously registered silently but left the provider unreachable and replaced the prototype of the manager's internal records instead of storing it.
