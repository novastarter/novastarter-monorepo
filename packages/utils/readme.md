# `@novastarter/utils`

Utilities shared between the Novastarter packages.

## Installation

```
pnpm add @novastarter/utils
```

## Usage

```ts
import { defaults, formatTitle, getSimpleHash, isIn, parseJSON, toArray, toBoolean } from '@novastarter/utils';
import { isReadableStream, processId, requireYaml } from '@novastarter/utils/node';
```

| Helper                         | Entry  | What it does                                                                            |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| `defaults(obj, def)`           | shared | Fill the missing optional keys of an options object from a defaults object.             |
| `formatTitle(str, separator?)` | shared | Turn any string into Title Case; see below.                                             |
| `getSimpleHash(str)`           | shared | Short, stable hex digest of a string for keys and ids — not cryptographic.              |
| `isIn(value, tuple)`           | shared | Whether a string is a member of a readonly tuple, narrowing its type.                   |
| `normalizePath(path)`          | shared | Forward-slash form of a path, repeated separators collapsed, trailing one dropped.      |
| `parseJSON(text)`              | shared | `JSON.parse` that drops `__proto__` keys, so untrusted input cannot pollute prototypes. |
| `toArray(value)`               | shared | Wrap a value in an array, splitting a string on commas.                                 |
| `toBoolean(value)`             | shared | `true` for `'true'`, `true`, `'1'`, `1`; `false` for everything else.                   |
| `DriverManager`                | shared | Registry of driver classes and named locations; see below.                              |
| `isReadableStream(value)`      | node   | Structural check for a Node `Readable`, across copies of the `stream` module.           |
| `processId()`                  | node   | Id unique to the current process on the current machine.                                |
| `requireYaml(path)`            | node   | Read and parse a YAML file synchronously.                                               |

## `DriverManager`

The registration shape every subsystem of the kit shares: drivers are registered as classes, locations as explicit
options, and consumers ask for a location by name; the driver is built on the location's first use. The second type
parameter maps driver names to their options, so `driver` decides the type of `options` — each package declares its map
as an augmentable interface (`StorageDrivers`, `QueueDrivers`, `KvDrivers`, …). `StorageManager`, `QueueManager`,
`KvManager` and the others extend it; a new subsystem does the same rather than inventing its own. Every driver contract
declares an optional `close()` (`Closable`); `close()` on the manager calls it on the drivers built so far, drops them
and keeps the registrations, so a location asked for after shutdown is built afresh. `location()` without a name answers
with `DEFAULT_LOCATION` (`default`), the one location a deployment with a single bucket, server or provider registers.

```ts
import { DriverManager } from '@novastarter/utils';

const manager = new DriverManager<StorageDriver, { s3: StorageDriverS3Config; local: StorageDriverLocalConfig }>();

manager.registerDriver('s3', StorageDriverS3);
manager.registerLocation('uploads', {
	driver: 's3',
	options: {
		bucket: 'uploads',
	},
});

manager.location('uploads'); // the StorageDriverS3 instance, built now and reused afterwards
manager.location(); // the location named DEFAULT_LOCATION, `default`
manager.hasLocation('uploads'); // true
manager.locationNames(); // ['uploads']
manager.instantiated(); // Map { 'uploads' => StorageDriverS3 }
await manager.close(); // StorageDriverS3.close(), then instantiated() is empty
```

## `LocationManager`

What `DriverManager` is built on: named locations, each registered with the arguments it is built from and built on its
first `location(name)` call, without the driver step. A subsystem with one client library — `RedisManager` of
`@novastarter/redis` — extends it directly: `build()` says how a location's instance is made from its registration,
`release()` how a built one lets go of its connections at `close()`. The second type parameter is the tuple of arguments
`registerLocation(name, ...)` takes after the name, so a subclass keeps its own signature.

```ts
import { LocationManager } from '@novastarter/utils';

class RedisManager extends LocationManager<Redis, [config: RedisConfig, overrides?: RedisOptions]> {
	protected build(config: RedisConfig, overrides: RedisOptions = {}): Redis {
		return createRedis(config, overrides);
	}

	protected async release(redis: Redis): Promise<void> {
		await redis.quit();
	}
}
```

## `singleton`

The `use*()` accessor of every manager: the builder runs on the first call, every later call answers with the same
instance, `replace()` swaps in an instance the application built itself — what `registerLogger()` does — and `reset()`
drops it for a test that needs a clean slate. A builder may take arguments; those of the first call are what the
instance is built from, later calls answer with it whatever they are given.

```ts
import { type Singleton, singleton } from '@novastarter/utils';

export const useStorage: Singleton<StorageManager> = singleton(() => new StorageManager());

useStorage() === useStorage(); // true
useStorage.replace(new StorageManager()); // every later call answers with this one
useStorage.reset(); // the next call builds a new manager

export const useEnv: Singleton<Env, [options?: CreateEnvOptions]> = singleton((options) => createEnv(options));

useEnv({ fileVariables: ['DB_PASSWORD'] }); // built from these options
useEnv(); // the same object
```

## `formatTitle`

Custom formatter that converts any string into
[Title Case](https://apastyle.apa.org/style-grammar-guidelines/capitalization/title-case).

Capital letters are used for principal words. Articles, conjunctions, and prepositions do not get capital letters unless
they start or end the title.

| Input                        | Output                          |
| ---------------------------- | ------------------------------- |
| `snowWhiteAndTheSevenDwarfs` | Snow White and the Seven Dwarfs |
| `NewcastleUponTyne`          | Newcastle Upon Tyne             |
| `brighton_on_sea`            | Brighton on Sea                 |
| `apple_releases_new_ipad`    | Apple Releases New iPad         |
| `7-food-trends`              | 7 Food Trends                   |

> The helper contains a list of words that use some sort of special casing, for example: McDonalds, iPhone, and YouTube.

By default it converts camelCase, PascalCase, underscore, and "regular" sentences to Title Case.

```ts
import { formatTitle } from '@novastarter/utils';

formatTitle('snowWhiteAndTheSevenDwarfs');
// => Snow White and the Seven Dwarfs
```

You can provide an optional `separator` regex as a second parameter to support splitting the string on different
characters. By default, this regex is set to `/\s|-|_/g`.

Ported from [`@directus/format-title`](https://github.com/directus/directus/tree/main/packages/format-title) (MIT,
Copyright Monospace, Inc.).
