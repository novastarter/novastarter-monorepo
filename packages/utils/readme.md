# `@novastarter/utils`

Utilities shared between the Novastarter packages.

## Installation

```
pnpm add @novastarter/utils
```

## Usage

```ts
import { defaults, formatTitle, joinPath, retry, sleep, toNumber, tryParseJSON } from '@novastarter/utils';
import { isReadableStream, processId, requireYaml } from '@novastarter/utils/node';
```

| Helper                          | Entry  | What it does                                                                                 |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `defaults(obj, def)`            | shared | Fill the missing optional keys of an options object from a defaults object.                  |
| `formatTitle(str, separator?)`  | shared | Turn any string into Title Case; see below.                                                  |
| `getSimpleHash(str)`            | shared | Short, stable hex digest of a string for keys and ids — not cryptographic.                   |
| `isIn(value, tuple)`            | shared | Whether a string is a member of a readonly tuple, narrowing its type.                        |
| `joinPath(...segments)`         | shared | `path.posix.join` without Node: forward slashes, `.` and `..` resolved; see below.           |
| `normalizePath(path)`           | shared | Forward-slash form of a path, repeated separators collapsed, trailing one dropped.           |
| `parseJSON(text)`               | shared | `JSON.parse` that drops `__proto__` keys, so untrusted input cannot pollute prototypes.      |
| `retry(fn, options?)`           | shared | Run an operation again with a pause between attempts until it succeeds; see below.           |
| `sleep(ms, signal?)`            | shared | Promise that resolves after `ms`, or rejects early when the signal aborts.                   |
| `toArray(value)`                | shared | Wrap a value in an array, splitting a string on commas.                                      |
| `toBoolean(value)`              | shared | `true` for `'true'`, `true`, `'1'`, `1`; `false` for everything else.                        |
| `toError(value)`                | shared | The value when it is an `Error`, otherwise an `Error` wrapping it with the value as `cause`. |
| `toErrorMessage(error)`         | shared | The `message` of an `Error`, anything else thrown written as text.                           |
| `toNumber(value)`               | shared | A finite number from a number or numeric string; `undefined` for anything else.              |
| `tryParseJSON(text, fallback?)` | shared | `parseJSON` that answers with `fallback` instead of throwing when `text` is not JSON.        |
| `withTimeout(op, ms, options?)` | shared | Wait for a promise, or run a function with a signal, and give up once `ms` pass; see below.  |
| `DriverManager`                 | shared | Registry of driver classes and named locations; see below.                                   |
| `isReadableStream(value)`       | node   | Structural check for a Node `Readable`, across copies of the `stream` module.                |
| `processId()`                   | node   | Id unique to the current process on the current machine.                                     |
| `requireYaml(path)`             | node   | Read and parse a YAML file synchronously.                                                    |

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

## `retry`

Runs an operation again until it succeeds, pausing between attempts, and throws the error of the last attempt as it came
once the budget is spent. The operation receives the attempt number, `1` for the first call. Options, each with its
default in `DEFAULT_RETRY_OPTIONS`: `retries` (3, attempts after the first), `delay` (100 ms; a number grown by `factor`
on each retry, or a function of the retry number), `factor` (2; `1` keeps the pause constant), `maxDelay` (none),
`jitter` (0; a fraction of the pause between 0 and 1, anything else is a `RangeError`: each pause is multiplied by a
factor drawn evenly between `1 - jitter` and `1 + jitter`, so workers that failed together do not retry together),
`shouldRetry(error, attempt)` (every error), `onRetry(error, attempt, delay)` (called before each pause, for a log
line), `signal` (aborting it ends a pause with the abort reason, and a signal already aborted runs no attempt; the error
of the attempt before the pause went to `onRetry`).

```ts
import { retry } from '@novastarter/utils';

const parts = await retry(() => listParts(uploadId), {
	retries: 3,
	delay: (attempt) => 500 * attempt, // 0.5 s, 1 s, 1.5 s
});

await retry(() => fetchJson(url), {
	shouldRetry: (error) => error instanceof HttpError && error.status >= 500,
});

await retry(() => publish(event), {
	jitter: 0.2, // 80–120 % of each pause
	onRetry: (error, attempt, delay) => logger.warn(error, `publish attempt ${attempt} failed, next in ${delay} ms`),
});
```

## `withTimeout`

Waits for an operation and rejects with a `TimeoutError` once `ms` pass. Two forms: a promise is raced against the clock
— on timeout the caller gets the error, but the promise runs on, since JavaScript cannot cancel it — and a function
receives an `AbortSignal` that is aborted with the timeout error at the deadline, so a `fetch` or an SDK call that takes
a signal really stops. Options: `error(ms)` (a factory for the error thrown on timeout, so a package throws its own
class), `signal` (aborting it ends the wait at once with the abort reason and aborts the function's signal too). The
timer is cleared as soon as the operation settles.

```ts
import { withTimeout } from '@novastarter/utils';

await withTimeout(processor(job.data), 30_000, {
	error: (ms) => new JobTimeoutError(name, ms),
});

const response = await withTimeout((signal) => fetch(url, { signal }), 5_000);
```

## `joinPath`

`path.posix.join` without `node:path`, for object-storage keys and URL paths that must come out the same on every
platform: segments are joined with `/`, backslashes and repeated separators are collapsed, `.` and `..` are resolved — a
`..` above the root of an absolute path is dropped, above the start of a relative one it stays in front — and a trailing
slash is removed. Not for filesystem paths: a Windows drive (`C:`) or UNC root is an ordinary segment a `..` can pop;
`node:path` knows those.

```ts
import { joinPath } from '@novastarter/utils';

joinPath('uploads', 'avatars', 'me.png'); // 'uploads/avatars/me.png'
joinPath('/root', '../etc', './passwd'); // '/etc/passwd'
joinPath('a', '..', '..', 'b'); // '../b'
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
