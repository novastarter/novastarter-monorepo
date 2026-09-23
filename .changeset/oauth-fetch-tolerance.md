---
'@novastarter/auth-driver-google': patch
'@novastarter/auth-driver-github': patch
---

The Google driver now verifies ID tokens with a 30-second clock tolerance, so a server a few seconds fast no longer rejects tokens at the end of their validity, and fetches Google's key set through the fetch the location configured instead of the global one, so a callback no longer bypasses an injected egress fetch; the GitHub driver now reads a spent rate limit on the addresses endpoint (`x-ratelimit-remaining: 0` or a secondary-limit message) as the retryable `HitRateLimitError` it is, instead of silently signing in an email-less identity.
