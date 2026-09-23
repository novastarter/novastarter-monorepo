---
'@novastarter/env': patch
---

A `boolean:` value other than `true`, `1`, `false` or `0` (such as `boolean:TRUE` or `boolean:yes`) is now refused at start-up with an error naming it instead of silently becoming `false`; spell it as one of the four accepted values.
