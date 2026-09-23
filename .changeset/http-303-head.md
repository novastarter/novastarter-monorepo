---
"@novastarter/http": patch
---

`httpCall` no longer turns a `HEAD` into a `GET` when following a 303 redirect; the redirected request stays a `HEAD`, matching fetch and browser semantics.
