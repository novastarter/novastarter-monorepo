---
'@novastarter/validation': patch
---

For a failed `_regex` rule, the Joi converter now puts the pattern the field had to match into `FailedValidationError` extensions' `invalid` — the meaning the zod converter has always given it — instead of the rejected payload value, so both validators report regex failures alike.
