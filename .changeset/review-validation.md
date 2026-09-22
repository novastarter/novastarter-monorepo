---
'@novastarter/validation': minor
---

`validatePayload` no longer throws on an empty string against the substring operators or on an infinite number against a range operator, reports `_eq` / `_neq` with a numeric value as `eq` / `neq` with the scalar instead of `in` / `nin`, and reports the `_starts_with` / `_ends_with` substring as written; the extended `Joi` gains `starts_with`, `nstarts_with`, `istarts_with`, `nistarts_with`, `ends_with`, `nends_with`, `iends_with` and `niends_with` string rules, and `joiValidationErrorItemToErrorExtensions` maps those rules instead of hand-built named `pattern()` details, which now throw like any unknown rule.
