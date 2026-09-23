---
'@novastarter/validation': patch
---

Malformed compare values no longer crash payload validation: `_in` / `_nin` / range / `_between` / `_nbetween` rules with non-list, unparseable, unsafe or incomplete bounds degrade to a rule that fails (or, for `_nin`, passes) every value instead of throwing, and a payload inside an `_nbetween` range is reported as a `nbetween` validation error with the two bounds rather than crashing `validatePayload` with an unmapped Joi alternatives error.
