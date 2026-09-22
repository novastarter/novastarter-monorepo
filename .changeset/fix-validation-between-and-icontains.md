---
'@novastarter/validation': patch
---

`_nbetween` filters validate correctly again: the schema is the complement of the range (a value below the low bound or above the high bound) instead of a combination that rejected every value; `_between` / `_nbetween` with a non-array value produce a validation error instead of throwing `TypeError: every is not a function`; `_icontains` failures are reported with `type: 'icontains'` instead of `'contains'`.
