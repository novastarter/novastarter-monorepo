---
'@novastarter/auth-driver-github': patch
---

A GitHub sign-in whose profile request hits the rate limit now fails with a retryable `HitRateLimitError` carrying GitHub's reset time instead of a generic `AuthProviderFailedError`.
