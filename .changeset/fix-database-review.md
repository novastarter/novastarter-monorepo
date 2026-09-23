---
'@novastarter/database': patch
---

`DatabaseUnavailableError` from `ping()` now reports the connection's own error (refused, auth, DNS) as its reason and cause instead of Drizzle's generic `Failed query: select 1` text.

A refused `localhost` connection, which Node reports as an `AggregateError` with an empty message, now gives the refused addresses as the reason instead of `AggregateError`.
