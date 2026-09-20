# `@novastarter/env`

The process configuration, read once and handed out.

## Description

`useEnv()` returns one object with every configuration variable: `process.env`, then the config file over it
(`CONFIG_PATH`, `.env` in the working directory unless set — dotenv, JSON, YAML or a JS module, by extension). A
variable the application names in `fileVariables` may be given as `<VARIABLE>_FILE`, a path its value is read from, the
way container platforms mount secrets. Values keep the type their source gave them — a string from the environment,
whatever a config file holds — unless they carry an explicit cast prefix (`number:1`, `array:a,b`, `json:{"a":1}`);
nothing is guessed from the look of a value. The object is built on the first call and cached, so every consumer sees
the same configuration.

Turning those strings into the types the application needs, with defaults and validation, is the job of a schema in the
application — zod, in the kit — so a wrong or missing variable fails at start-up with a clear message and every read
afterwards is typed. The package holds no list of variables and no defaults of its own beyond `CONFIG_PATH`. Packages of
the kit never read the environment themselves: the application reads the values it needs and passes them explicitly when
it registers drivers and locations at start-up — see the readme of each package.

## Installation

```
pnpm add @novastarter/env
```

## Usage

The application's schema, once:

```ts
// env.ts
import { useEnv } from '@novastarter/env';
import { z } from 'zod';

export const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
	REDIS: z.url().optional(),
	QUEUE_MAIL_REDIS: z.url().optional(),
	QUEUE_MAIL_PREFIX: z.string().default('novastarter'),
});

// Every variable of the schema may come from a `<NAME>_FILE`
export const env = envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
```

Anywhere later — typed, no casts:

```ts
import { env } from './env.js';

env.LOG_LEVEL; // 'info'
env.QUEUE_MAIL_REDIS; // string | undefined
```

Wiring a package at start-up:

```ts
import { useRedis } from '@novastarter/redis';
import { env } from './env.js';

if (env.REDIS) useRedis().registerLocation('default', env.REDIS);
```

## Configuration

| Variable      | Default | Description                                                                                   |
| ------------- | ------- | --------------------------------------------------------------------------------------------- |
| `CONFIG_PATH` | `.env`  | Config file merged over `process.env`; the extension picks the parser.                        |
| `<NAME>_FILE` | —       | Path to read `<NAME>` from, for the names passed in `fileVariables`, e.g. `DB_PASSWORD_FILE`. |

A value may carry a cast prefix: `string:`, `number:`, `boolean:`, `array:`, `json:`, `regex:`. `array:` takes a comma
separated list whose items may carry prefixes of their own: `array:string:a,number:1` gives `['a', 1]`.
