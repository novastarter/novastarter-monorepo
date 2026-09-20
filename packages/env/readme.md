# `@novastarter/env`

The process configuration, read once and handed out typed.

## Description

`useEnv()` returns one object with every configuration variable: `process.env` merged over the defaults, then the config
file over that (`CONFIG_PATH`, `.env` in the working directory unless set — dotenv, JSON, YAML or a JS module, by
extension). Every value is cast to its type — numbers, booleans, arrays, JSON and regexes — either by the type map of
known variables, by an explicit prefix on the value (`number:1`, `array:a,b`, `json:{"a":1}`) or, failing both, by its
look. A known variable given as `<VARIABLE>_FILE` has its value read from that path, the way container platforms mount
secrets. The object is built on the first call and cached, so every consumer sees the same configuration.

Packages of the kit never read the environment themselves. The application reads the values it needs from `useEnv()` and
passes them explicitly when it registers drivers and locations at start-up — see the readme of each package.

## Installation

```
pnpm add @novastarter/env
```

## Usage

```ts
import { useEnv } from '@novastarter/env';

const env = useEnv();

env['DB_PORT']; // 5432, a number
env['LOG_HTTP_IGNORE_PATHS']; // ['/server/ping'], an array
env['CACHE_ENABLED']; // false, the default
```

Wiring a package at start-up:

```ts
import { useEnv } from '@novastarter/env';
import { useRedis } from '@novastarter/redis';

const env = useEnv();

useRedis().registerLocation('default', env['REDIS'] as string);
```

## Configuration

| Variable      | Default | Description                                                                          |
| ------------- | ------- | ------------------------------------------------------------------------------------ |
| `CONFIG_PATH` | `.env`  | Config file merged over `process.env`; the extension picks the parser.               |
| `<NAME>_FILE` | —       | Path to read the value of the known variable `<NAME>` from, e.g. `DB_PASSWORD_FILE`. |

A value may carry a cast prefix: `string:`, `number:`, `boolean:`, `array:`, `json:`, `regex:`. `array:` takes a comma
separated list whose items may carry prefixes of their own: `array:string:a,number:1` gives `['a', 1]`.
