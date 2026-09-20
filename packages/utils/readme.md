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
`KvManager` and the others extend it; a new subsystem does the same rather than inventing its own.

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
manager.hasLocation('uploads'); // true
manager.locationNames(); // ['uploads']
manager.instantiated(); // Map { 'uploads' => StorageDriverS3 }
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
