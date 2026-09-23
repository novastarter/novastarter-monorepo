---
'@novastarter/http': patch
---

A `Date` parameter is now sent as its bare ISO 8601 string in query strings, form bodies and multipart fields, instead of a JSON-quoted string.
