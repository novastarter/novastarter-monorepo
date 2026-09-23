---
'@novastarter/http': minor
---

`http()` and `request()` take `hooks` — `onRequest`, `onResponse` and `onError`, in the options or on a driver's `HttpApi` — called around every request with the provider, the label, the verb, the URL without its query, the status and the duration, for logs and metrics; a failing hook never breaks the request.
