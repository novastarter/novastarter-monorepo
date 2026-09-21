# `@novastarter/memory`

Memory / Redis abstraction: key-value store, cache, pub/sub bus and rate limiter.

## Installation

```
pnpm add @novastarter/memory
```

## Usage

At start-up, once — every manager knows its built-in drivers (`local`, `redis`; `multi` for the cache), so a location
needs its options alone:

```ts
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { useRedis } from '@novastarter/redis';

const redis = useRedis().location('default');

useKv().registerLocation('default', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'kv',
	},
});
useCache().registerLocation('default', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'cache',
		ttl: 60_000,
	},
});
useBus().registerLocation('default', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'novastarter',
	},
});
useLimiter().registerLocation('api', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'api',
		points: 50,
		duration: 1,
	},
});
```

In development, without Redis — the same lines with `driver: 'local'` and the local options. `driver` decides the type
of `options`: `{ driver: 'redis', options: { maxKeys: 5 } }` does not compile.

Anywhere later:

```ts
import { useCache, useLimiter } from '@novastarter/memory';

await useCache().location('default').set('schema', schema);
await useLimiter().location('api').consume(ip);
```

`close()` on a manager releases what its locations built so far — the bus's subscribing connection — and keeps the
registrations; the Redis client a location was handed belongs to `@novastarter/redis` and is closed there.

A standalone instance, outside the managers — the driver classes are exported:

```ts
import { KvDriverLocal } from '@novastarter/memory';

const kv = new KvDriverLocal({ maxKeys: 500 });

await kv.set('my-key', 'my-value');
```

A driver of the application's own joins a manager once it is added to the driver map:

```ts
declare module '@novastarter/memory' {
	interface KvDrivers {
		memcached: KvDriverMemcachedConfig;
	}
}

useKv().registerDriver('memcached', KvDriverMemcached);
```

## Kv

A key-value store with `get`, `set`, `delete`, `has`, `increment` and `setMax` (store only a larger number; a Lua script
on Redis) and locks. Local options: `maxKeys`, `ttl`. Redis options: `redis`, `namespace`, `ttl`, `compression` (gzip
values above `compressionMinSize`, on by default), `lockTimeout`.

## Cache

A Kv with an LRU behind it. Local options: `maxKeys`, `ttl`. Redis options: those of the Kv. `multi` keeps a local cache
in front of a Redis one and clears the local copies of every process through the bus when a key changes:
`{ local: { … }, redis: { … } }`.

## Bus

A pub/sub abstraction: `publish(channel, payload)` and `subscribe(channel, handler)`. The local backend only serves
handlers of the same process, which adds no benefit next to having one API for both. Redis options: `redis`,
`namespace`, `compression`.

## Limiter

A shared rate limiter: `consume(key)` takes one point of the key's budget and throws `HitRateLimitError` of
`@novastarter/errors` once the `points` of a `duration` (seconds) are spent. Redis options add `redis` and `namespace`.
