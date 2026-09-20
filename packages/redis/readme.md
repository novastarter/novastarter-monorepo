# `@novastarter/redis`

Shared [ioredis](https://github.com/redis/ioredis) clients built from the `REDIS_*` environment variables.

## Description

The `@novastarter/memory` backends (`Kv`, `Cache`, `Bus`, `Limiter`) take a ready Redis client; this package is where
that client comes from. `useRedis()` hands out one connection per location and process, `createRedis()` opens a fresh
one, and `redisConfigAvailable()` tells whether the environment configures a location at all, so a service can fall back
to the in-memory backends without an extra flag. Locations follow the storage convention: one server is the default and
needs no name, further servers are listed in `REDIS_LOCATIONS` and configured under `REDIS_<NAME>_*`. Ported from the
Directus `@directus/redis` package.

## Installation

```
pnpm add @novastarter/redis
```

## Usage

Picking the backend of a memory subsystem from the environment:

```ts
import { createBus, createCache } from '@novastarter/memory';
import { redisConfigAvailable, useRedis } from '@novastarter/redis';

const bus = redisConfigAvailable()
	? createBus({ type: 'redis', redis: useRedis(), namespace: 'novastarter' })
	: createBus({ type: 'local' });

const cache = redisConfigAvailable()
	? createCache({ type: 'redis', redis: useRedis(), namespace: 'novastarter', ttl: 60_000 })
	: createCache({ type: 'local', maxKeys: 500 });
```

Every subsystem passes the same `useRedis()` client; the bus duplicates it by itself for subscribing.

A second server gets a location name. Declare it, configure it under its own prefix and ask for it by name:

```sh
REDIS=redis://cache:6379

REDIS_LOCATIONS=queue
REDIS_QUEUE=redis://queue:6379
```

```ts
import { createLimiter } from '@novastarter/memory';
import { redisConfigAvailable, useRedis } from '@novastarter/redis';

const limiter = redisConfigAvailable('queue')
	? createLimiter({ type: 'redis', redis: useRedis('queue'), namespace: 'novastarter', points: 10, duration: 5 })
	: createLimiter({ type: 'local', points: 10, duration: 5 });
```

`useRedis('queue')` returns the same client on every call, separate from `useRedis()`. A location that is not listed in
`REDIS_LOCATIONS` is not known to the default client, which then picks up its variables as its own options.

An independent, non-shared connection — for a blocking command, for example — comes from `createRedis()`, with the same
optional location name:

```ts
import { createRedis } from '@novastarter/redis';

const worker = createRedis('queue');

await worker.blpop('jobs', 0);
```

## Configuration

The default location reads the plain variables; a location `queue` reads the same set with `REDIS_QUEUE` in place of
`REDIS`, i.e. `REDIS_QUEUE`, `REDIS_QUEUE_ENABLED`, `REDIS_QUEUE_HOST` and so on.

| Variable          | Default | Description                                                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `REDIS_LOCATIONS` | —       | Names of the additional locations, comma separated. The default location is implicit and never listed.      |
| `REDIS`           | —       | Connection URL, e.g. `redis://user:pass@host:6379/0`. Wins over the split variables.                        |
| `REDIS_ENABLED`   | —       | `true` / `false` switch. Unset, the location counts as enabled once its URL or any of its variables is set. |
| `REDIS_HOST`      | —       | Server host.                                                                                                |
| `REDIS_PORT`      | —       | Server port.                                                                                                |
| `REDIS_USERNAME`  | —       | ACL user name.                                                                                              |
| `REDIS_PASSWORD`  | —       | Password.                                                                                                   |
| `REDIS_DB`        | —       | Database index.                                                                                             |
| `REDIS_*`         | —       | Any other ioredis option, e.g. `REDIS_TLS__REJECT_UNAUTHORIZED=false`; `__` nests.                          |

Every variable above can also be given as `<VARIABLE>_FILE` with a path to read the value from, the way secrets are
mounted by container platforms.

The `REDIS_BUS_NAMESPACE`, `REDIS_LOCK_NAMESPACE`, `REDIS_COUNTERS_NAMESPACE` and `REDIS_PERMISSIONS_NAMESPACE`
variables belong to the subsystems that use the client and are not passed to ioredis.
