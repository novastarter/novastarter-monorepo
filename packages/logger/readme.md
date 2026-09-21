# `@novastarter/logger`

Structured logging for Novastarter, built on [pino](https://getpino.io).

## Installation

```
pnpm add @novastarter/logger
```

## Usage

At start-up, once; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { createLogger, registerLogger, resolveLogStyle } from '@novastarter/logger';
import { env } from './env';

registerLogger(
	createLogger({
		level: env.LOG_LEVEL,
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
log during start-up. `useLogger` is a `singleton` of `@novastarter/utils` like every `use*()` of the kit:
`useLogger.reset()` drops the logger for a test that needs a clean slate.

Request logging, on any Node HTTP server — a child of the process logger, one line per request:

```ts
import { createHttpLogger, useLogger } from '@novastarter/logger';
import { env } from './env';

const httpLogger = createHttpLogger({
	logger: useLogger(),
	ignorePaths: env.LOG_HTTP_IGNORE_PATHS,
});

http.createServer((req, res) => {
	httpLogger(req, res);
	// …
});
```

Streaming logs to every instance through the message bus:

```ts
import { createLogger, getLogsStream } from '@novastarter/logger';
import { useBus } from '@novastarter/memory';

const logger = createLogger({
	logsStream: {
		stream: getLogsStream(true, useBus().location('default')),
		level: 'debug',
	},
});
```

## Options

`createLogger()`:

| Option       | Default | Description                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------------- |
| `level`      | `info`  | Lowest level written: `fatal`, `error`, `warn`, `info`, `debug`, `trace`.       |
| `style`      | `raw`   | `pretty` for humans, `raw` for JSON lines.                                      |
| `levels`     | —       | `{ warn: 'WARNING' }` — adds a `severity` field for collectors that expect one. |
| `pino`       | —       | Merged into the pino options, e.g. `{ name: 'api' }`.                           |
| `logsStream` | —       | Extra destination, with its own `level`.                                        |

`createHttpLogger()`:

| Option        | Default | Description                                                 |
| ------------- | ------- | ----------------------------------------------------------- |
| `logger`      | —       | Required: the logger the request lines are written through. |
| `ignorePaths` | —       | Paths it stays quiet about, e.g. `['/server/ping']`.        |
| `http`        | —       | Merged into the pino-http options.                          |

`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` and `access_token` in the query string
are always redacted (`REDACTED_PATHS`). `resolveLogStyle(env)` is the rule for the style: an explicit `LOG_STYLE` wins,
otherwise `NODE_ENV=production` means `raw` — a log collector parses JSON and chokes on a pretty line — and everything
else means `pretty`.
