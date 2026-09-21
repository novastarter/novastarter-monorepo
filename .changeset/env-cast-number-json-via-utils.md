---
'@novastarter/env': patch
---

`number:` cast now yields `undefined` instead of `NaN` for a payload that is not a finite number and instead of `0` for an empty one, `regex:` yields `undefined` instead of throwing for a pattern that does not compile, an `array:` member that casts to `undefined` is dropped like an empty one, and `json:` parses through `tryParseJSON` of `@novastarter/utils`.
