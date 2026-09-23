---
'@novastarter/validation': patch
---

A malformed rule (`_in: []`, a non-string `_contains`, an unparseable range bound, a bad `_regex`) now fails every present value, including `true`, reported as `{ type: 'in', valid: [] }`; a bare value like `{ status: 'published' }` throws a plain `Error` instead of overflowing the stack, and a second field, operator or sibling key on one filter level throws instead of being skipped.
