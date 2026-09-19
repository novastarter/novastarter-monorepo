# `@novastarter/memory`

Memory / Redis abstraction: key-value store, cache, pub/sub bus and rate limiter

Several subsystems need ephemeral storage that is synced between the processes of one deployment. To streamline that
setup, this package exports four classes that are used for everything related to ephemeral storage:

- [Kv](#kv)
- [Cache](#cache)
- [Bus](#bus)
- [Limiter](#limiter)

## Kv

The Kv class is a simple key-value store

### Basic Usage

```ts
import { createKv } from '@novastarter/memory';

const kv = createKv({
	type: 'local',
});

await kv.set('my-key', 'my-value');
```

## Cache

The cache class is a Kv class extended with an LRU store

### Basic Usage

```ts
import { createCache } from '@novastarter/memory';

const cache = createCache({
	type: 'local',
	maxKeys: 500,
});

await cache.set('my-key', 'my-value');
```

## Bus

The bus class is a pub-sub abstraction. The local type bus just handles local handlers, which adds no benefit next to
having a shared API for using pubsub.

### Basic Usage

```ts
import { Redis } from 'ioredis';
import { createBus } from '@novastarter/memory';

const bus = createBus({
	type: 'redis',
	redis: new Redis(),
	namespace: 'app',
});
```

## Limiter

The limiter class is a basic shared rate limiter.

### Basic Usage

```ts
import { createLimiter } from '@novastarter/memory';

const limiter = createLimiter({
	type: 'local',
	points: 10,
	duration: 5,
});
```
