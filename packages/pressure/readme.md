# `@novastarter/pressure`

Event loop and memory pressure monitor, with an Express middleware that sheds load.

## Installation

```
pnpm add @novastarter/pressure
```

## Usage

Standalone — the monitor is a class that can be used anywhere:

```ts
import { PressureMonitor } from '@novastarter/pressure';

const monitor = new PressureMonitor({
	maxEventLoopUtilization: 0.8,
	maxMemoryHeapUsed: 512 * 1024 * 1024,
});

monitor.overloaded; // true | false
```

Express — a middleware that forwards an error to the app's error handler while the monitor reports overload, and is
transparent otherwise:

```ts
import express from 'express';
import { HitRateLimitError } from '@novastarter/errors';
import { handlePressure } from '@novastarter/pressure';

const app = express();

app.use(
	handlePressure({
		maxEventLoopUtilization: 0.8,
		retryAfter: '5',
		error: new HitRateLimitError({
			limit: 0,
			reset: new Date(Date.now() + 5_000),
		}),
	}),
);
```

`error` is what reaches `next()` — a plain `Error('Pressure limit exceeded')` unless given — and `retryAfter` sets the
`Retry-After` header on a rejected request.

## Options

| Option                    | Default | Description                                                        |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `maxEventLoopDelay`       | `false` | Largest tolerated mean event loop delay in milliseconds.           |
| `maxEventLoopUtilization` | `false` | Largest tolerated event loop utilization, a ratio between 0 and 1. |
| `maxMemoryHeapUsed`       | `false` | Largest tolerated V8 heap usage in bytes.                          |
| `maxMemoryRss`            | `false` | Largest tolerated resident set size in bytes.                      |
| `sampleInterval`          | —       | Milliseconds between two samples.                                  |
| `resolution`              | —       | Sampling rate of the event loop delay histogram in milliseconds.   |

`false` disables a check; only the limits set are enforced.
