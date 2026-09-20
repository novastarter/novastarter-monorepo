---
'@novastarter/validation': minor
'@novastarter/types': minor
---

Add `@novastarter/validation` with `validatePayload`, which checks a payload against `_and` / `_or` / field filter rules and returns `FailedValidationError`s with per-field `extensions`, plus `generateJoi` and `joiValidationErrorItemToErrorExtensions`; the `Filter`, `FieldFilter` and operator types now live in `@novastarter/types`.
