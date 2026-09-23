---
'@novastarter/errors': patch
---

`isNovastarterError` no longer throws on hostile values such as revoked Proxies and returns `false` for them instead.
