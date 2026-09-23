---
'@novastarter/env': patch
---

A `__proto__` key in a configuration source can no longer swap the prototype of the object `useEnv()` returns, and the default `CONFIG_PATH` is now resolved against the working directory at lookup time instead of being frozen at import time.
