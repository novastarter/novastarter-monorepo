# `@novastarter/logger`

Structured logging for Novastarter, built on [pino](https://getpino.io).

## Description

One logger for the whole process (`useLogger()`), one request logger for HTTP servers (`createHttpLogger()`), both
redacting credentials before a line is written. The application builds them at start-up from its own configuration —
level, console style, extra pino options — and registers the process logger with `registerLogger()`; the package reads
nothing from the environment. Ported from the Directus API logger with the WebSocket wiring replaced by an injected
message bus.

## Installation

```
pnpm add @novastarter/logger
```

## Usage

At start-up, once:

```ts
import { useEnv } from '@novastarter/env';
import { createLogger, registerLogger, resolveLogStyle } from '@novastarter/logger';

const env = useEnv();

registerLogger(
	createLogger({
		level: env['LOG_LEVEL'] as string,
		style: resolveLogStyle(env),
		pino: { name: 'api' },
	}),
);
```

Anywhere later:

```ts
import { useLogger } from '@novastarter/logger';

const logger = useLogger();

logger.info('Server started');
logger.error(err, 'Request failed');
```

Before `registerLogger()` runs, `useLogger()` answers with a default logger — `info`, raw JSON lines — so a package can
log during start-up.

Request logging, on any Node HTTP server:

```ts
import { createHttpLogger } from '@novastarter/logger';

const httpLogger = createHttpLogger({
	level: env['LOG_LEVEL'] as string,
	style: resolveLogStyle(env),
	ignorePaths: env['LOG_HTTP_IGNORE_PATHS'] as string[],
});

http.createServer((req, res) => {
	httpLogger(req, res);
	// …
});
```

Streaming logs to every instance through the message bus:

```ts
import { createLogger, getLogsStream } from '@novastarter/logger';
import { createBus } from '@novastarter/memory';
import { useRedis } from '@novastarter/redis';

const bus = createBus({ type: 'redis', redis: useRedis().location('default'), namespace: 'novastarter' });
const logger = createLogger({ logsStream: { stream: getLogsStream(true, bus), level: 'debug' } });
```

## Options

`createLogger()` and `createHttpLogger()` take:

| Option        | Default | Description                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------- |
| `level`       | `info`  | Lowest level written: `fatal`, `error`, `warn`, `info`, `debug`, `trace`.       |
| `style`       | `raw`   | `pretty` for humans, `raw` for JSON lines.                                      |
| `levels`      | —       | `{ warn: 'WARNING' }` — adds a `severity` field for collectors that expect one. |
| `pino`        | —       | Merged into the pino options, e.g. `{ name: 'api' }`.                           |
| `logsStream`  | —       | Extra destination, with its own `level`.                                        |
| `ignorePaths` | —       | Request logger only: paths it stays quiet about, e.g. `['/server/ping']`.       |
| `http`        | —       | Request logger only: merged into the pino-http options.                         |

`req.headers.authorization`, `req.headers.cookie` and `access_token` in the query string are always redacted; with raw
lines or a bus stream, `res.headers.set-cookie` is redacted as well. `resolveLogStyle(env)` is the rule for the style:
an explicit `LOG_STYLE` wins, otherwise `NODE_ENV=production` means `raw` — a log collector parses JSON and chokes on a
pretty line — and everything else means `pretty`.
