# `@novastarter/env`

The process configuration, read once and handed out.

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

The options belong to this first call; `useEnv()` anywhere else answers with the same object, and a later call that
passes options is refused rather than having them ignored. `useEnv.reset()` drops the configuration, for tests.

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
separated list whose items may carry prefixes of their own: `array:string:a,number:1` gives `['a', 1]`. A payload the
prefix cannot read — `number:80O0`, `regex:(` — is refused at start-up with an error naming the value, rather than
turned into a missing variable a schema default would cover.

A variable of `fileVariables` set both as `<NAME>` and `<NAME>_FILE` is refused at start-up as well: the sources
enumerate in no documented order, so letting one win would pick the secret by chance. A `<NAME>_FILE` whose file cannot
be read fails with the fs error (`ENOENT`, `EACCES`) quoted in the message and kept as the `cause`.
