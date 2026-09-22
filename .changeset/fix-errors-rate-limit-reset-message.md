---
'@novastarter/errors': patch
---

`HitRateLimitError` no longer renders a negative wait (`retry after -5s`) when the reset time lies in the past, and an invalid `reset` Date no longer makes the error constructor throw while building its message.
