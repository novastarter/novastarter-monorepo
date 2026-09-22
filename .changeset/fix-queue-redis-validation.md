---
'@novastarter/redis': patch
'@novastarter/queue': patch
'@novastarter/validation': patch
---

`RedisManager.close()` and the `bullmq` queue driver's `close()` no longer hang when a client never connected: a Redis client whose status is not `ready` is dropped with `disconnect()` instead of reconnecting forever to deliver QUIT.
`enqueue()` on the `bullmq` driver refuses a negative or `NaN` delay with the same `RangeError` the `local` driver throws, and `unique: true` derives the job id from a key-sorted serialisation of the payload, so the same work collapses into one job no matter the order the payload's keys were built in.
The `unsafe` validation failure now answers `Value is not valid.` for every rule without an operator form (refinements, unions, unknown keys), not just unsafe numbers; a `_regex` pattern that does not compile validates as never-matching instead of throwing `SyntaxError` out of schema building; `_in` with an empty list fails every value instead of passing everything; and compared boolean values are reported as `'true'` / `'false'`, matching the zod converter.
