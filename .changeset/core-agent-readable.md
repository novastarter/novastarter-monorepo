---
'@novastarter/utils': patch
'@novastarter/types': patch
'@novastarter/errors': patch
'@novastarter/constants': patch
'@novastarter/feature-flags': patch
---

`parseJSON` now returns `unknown` and event handlers get `meta` as `Record<string, unknown>`; narrow the values you read instead of relying on `any`.
