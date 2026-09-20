# `@novastarter/rate-limiter`

Pressure based rate limiter.

## Description

Samples the event loop delay and utilization and the memory of the process in the background and reports whether it is
overloaded, so a server can shed load before it falls over. Every threshold is off unless set; reading `overloaded` is a
comparison against the last sample, not a live measurement. Ported from `@directus/pressure`.

## Installation

```
pnpm add @novastarter/rate-limiter
```

## Usage

Standalone — the monitor is a class that can be used anywhere:

```ts
import { RateLimiter } from '@novastarter/rate-limiter';

const monitor = new RateLimiter({ maxEventLoopUtilization: 0.8, maxMemoryHeapUsed: 512 * 1024 * 1024 });

monitor.overloaded; // true | false
```

Express — a middleware that forwards an error to the app's error handler while the monitor reports overload, and is
transparent otherwise:

```ts
import express from 'express';
import { HitRateLimitError } from '@novastarter/errors';
import { handleRateLimit } from '@novastarter/rate-limiter';

const app = express();

app.use(
	handleRateLimit({
		maxEventLoopUtilization: 0.8,
		retryAfter: '5',
		error: new HitRateLimitError({ limit: 0, reset: new Date(Date.now() + 5_000) }),
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
