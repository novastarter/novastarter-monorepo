---
'@novastarter/http': patch
---

An aborted `http()` or `request()` now rejects with the caller's abort reason exactly as given, without the `status: 500` that `@octokit/request` added to it, and a redirect that would take the body to another origin or leave TLS is documented as refused.
