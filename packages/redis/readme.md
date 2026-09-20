# `@novastarter/redis`

Named Redis servers — locations — and the shared [ioredis](https://github.com/redis/ioredis) client of each.

## Installation

```
pnpm add @novastarter/redis
```

## Usage

At start-up, once; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useRedis } from '@novastarter/redis';
import { env } from './env';

const redis = useRedis();

redis.registerLocation('default', env.REDIS);
redis.registerLocation('jobs', {
	host: env.REDIS_JOBS_HOST,
	port: env.REDIS_JOBS_PORT,
	password: env.REDIS_JOBS_PASSWORD,
});
```

Anywhere later:

```ts
import { useBus, useCache } from '@novastarter/memory';
import { useRedis } from '@novastarter/redis';

const redis = useRedis().location('default');

useCache().registerLocation('default', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'app',
		ttl: 60_000,
	},
});
useBus().registerLocation('default', {
	driver: 'redis',
	options: {
		redis,
		namespace: 'app',
	},
});

await useRedis().location('jobs').ping();
```

`location(name)` opens the client on the first call and returns the same one afterwards; every subsystem passes the same
client, and the bus duplicates it by itself for subscribing. `hasLocation(name)` tells whether a name was registered,
`locationNames()` lists them, and `close()` quits every opened client at shutdown.

An independent, non-shared connection — for a blocking command, or a client library that needs its own settings — comes
from `createRedis()`, with ioredis options laid over the connection as its second argument:

```ts
import { createRedis } from '@novastarter/redis';
import { env } from './env';

const worker = createRedis(env.REDIS_JOBS, { maxRetriesPerRequest: null });

await worker.blpop('jobs', 0);
```

## Configuration

The package reads nothing from the environment; the variable names, their defaults and their `_FILE` variants are the
application's schema's — see `@novastarter/env`.
