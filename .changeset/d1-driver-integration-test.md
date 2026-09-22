---
'@novastarter/database-driver-d1': patch
---

Added an integration test for the D1 driver over wrangler's `getPlatformProxy()`; it runs when `D1_CONFIG` names a wrangler config with a d1 binding and skips otherwise.
