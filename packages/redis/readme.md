# `@novastarter/redis`

Named Redis servers — locations — and the shared [ioredis](https://github.com/redis/ioredis) client of each.

## Description

The `@novastarter/memory` backends (`Kv`, `Cache`, `Bus`, `Limiter`) and the `bullmq` queue driver take a ready Redis
client; this package is where that client comes from. At start-up the application registers every server it uses as a
location — a name plus the connection URL or ioredis options, taken from its own configuration — and from then on
`useRedis().location(name)` hands out the one client of that server to every consumer in the process. A location named
`default` answers for any name that has none of its own. Ported from the Directus `@directus/redis` package.

## Installation

```
pnpm add @novastarter/redis
```

## Usage

At start-up, once:

```ts
import { useEnv } from '@novastarter/env';
import { useRedis } from '@novastarter/redis';

const env = useEnv();
const redis = useRedis();

redis.registerLocation('default', env['REDIS'] as string);
redis.registerLocation('jobs', {
	host: env['REDIS_JOBS_HOST'] as string,
	port: env['REDIS_JOBS_PORT'] as number,
	password: env['REDIS_JOBS_PASSWORD'] as string,
});
```

Anywhere later:

```ts
import { createBus, createCache } from '@novastarter/memory';
import { useRedis } from '@novastarter/redis';

const cache = createCache({ type: 'redis', redis: useRedis().location('default'), namespace: 'app', ttl: 60_000 });
const bus = createBus({ type: 'redis', redis: useRedis().location('default'), namespace: 'app' });

await useRedis().location('jobs').ping();
```

`location(name)` returns the same client on every call; every subsystem passes the same one, and the bus duplicates it
by itself for subscribing. `hasLocation(name)` tells whether a name was registered, `locationNames()` lists them, and
`close()` quits every client at shutdown.

An independent, non-shared connection — for a blocking command, or a client library that needs its own settings — comes
from `createRedis()`, with ioredis options laid over the connection as its second argument:

```ts
import { createRedis } from '@novastarter/redis';

const worker = createRedis(env['REDIS_JOBS'] as string, { maxRetriesPerRequest: null });

await worker.blpop('jobs', 0);
```

## Configuration

The package reads nothing from the environment; the variable names are the application's. The kit's `@novastarter/env`
knows `REDIS`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB` and the `REDIS_<NAME>_*`
families, so each can be given as `<VARIABLE>_FILE` and numeric-looking passwords stay strings.
