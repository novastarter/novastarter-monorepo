# `@novastarter/logger`

Structured logging for Novastarter, built on [pino](https://getpino.io).

## Description

One logger for the whole process (`useLogger()`), one request logger for HTTP servers (`createHttpLogger()`), both
configured from the environment and both redacting credentials before a line is written. Ported from the Directus API
logger with the WebSocket wiring replaced by an injected message bus.

## Installation

```
pnpm add @novastarter/logger
```

## Usage

```ts
import { useLogger } from '@novastarter/logger';

const logger = useLogger();

logger.info('Server started');
logger.error(err, 'Request failed');
```

Request logging, on any Node HTTP server:

```ts
import { createHttpLogger } from '@novastarter/logger';

const httpLogger = createHttpLogger();

http.createServer((req, res) => {
	httpLogger(req, res);
	// …
});
```

Streaming logs to every instance through the message bus:

```ts
import { createBus } from '@novastarter/memory';
import { createLogger, getLogsStream } from '@novastarter/logger';

const bus = createBus({ type: 'redis', redis, namespace: 'novastarter' });
const logger = createLogger({ logsStream: { stream: getLogsStream(true, bus), level: 'debug' } });
```

## Configuration

| Variable                | Default | Description                                                                  |
| ----------------------- | ------- | ---------------------------------------------------------------------------- |
| `LOG_LEVEL`             | `info`  | Lowest level written: `fatal`, `error`, `warn`, `info`, `debug`, `trace`.    |
| `LOG_STYLE`             | —       | `pretty` for humans, `raw` for JSON lines; unset, `raw` in production.       |
| `LOG_HTTP_IGNORE_PATHS` | —       | Paths the request logger stays quiet about, comma separated.                 |
| `LOGGER_*`              | —       | Merged into the pino options, e.g. `LOGGER_NAME=api`.                        |
| `LOGGER_LEVELS`         | —       | `label:severity,…` — adds a `severity` field for collectors that expect one. |
| `LOGGER_HTTP_*`         | —       | Merged into the pino-http options.                                           |

`req.headers.authorization`, `req.headers.cookie` and `access_token` in the query string are always redacted; with
`LOG_STYLE=raw` or a bus stream, `res.headers.set-cookie` is redacted as well. `resolveLogStyle(env)` is the rule behind
the default: an explicit `LOG_STYLE` wins, otherwise `NODE_ENV=production` means `raw` — a log collector parses JSON and
chokes on a pretty line — and everything else means `pretty`.
