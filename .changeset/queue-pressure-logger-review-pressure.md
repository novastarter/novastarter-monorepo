---
'@novastarter/pressure': minor
---

`handlePressure()` accepts an error factory (`error: () => Error`, the pattern `withTimeout` uses) and clones a given `Error` per rejected request, so an error handler that mutates the forwarded error no longer shares that state between requests.
