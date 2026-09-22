---
'@novastarter/redis': patch
---

`createRedis(url, overrides)` reads the URL with ioredis's own parser — every form ioredis accepts, an IPv6 literal or a socket path included, means the same, and `rediss://` still turns TLS on — and lays the overrides over what it carries, query parameters and database included: ioredis keeps the URL's values over options given beside it, so `redis://host?maxRetriesPerRequest=20` used to defeat the `maxRetriesPerRequest: null` the BullMQ driver requires and make its worker refuse to start.
