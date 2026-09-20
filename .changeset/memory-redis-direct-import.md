---
'@novastarter/memory': patch
---

The Redis key-value and cache drivers import their option types directly instead of through the package barrel, removing an import cycle inside `@novastarter/memory`.
