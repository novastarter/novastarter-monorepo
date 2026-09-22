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

monitor.close(); // stops sampling; the timer never keeps the process alive, but the histogram runs until closed
```

Sampling runs in the background from the moment the monitor is created: an event loop delay histogram plus a timer that
re-arms itself after every sample. The timer is unref'd, so a finished process exits on its own, but neither stops
working until `close()` is called — a monitor that is created and dropped repeatedly, as in a test suite or under hot
reload, has to be closed. Event loop utilization is measured over the interval between two samples, so a spike after a
long quiet period is seen within one `sampleInterval`.

Express — a middleware that forwards an error to the app's error handler while the monitor reports overload, and is
transparent otherwise:

```ts
import express from 'express';
import { HitRateLimitError } from '@novastarter/errors';
import { handlePressure } from '@novastarter/pressure';

const app = express();

const handler = handlePressure({
	maxEventLoopUtilization: 0.8,
	retryAfter: '5',
	error: new HitRateLimitError({
		limit: 0,
		reset: new Date(Date.now() + 5_000),
	}),
});

app.use(handler);

const server = app.listen(3000);

server.on('close', () => handler.monitor.close());
```

`error` is what reaches `next()` — a plain `Error('Pressure limit exceeded')` unless given — and `retryAfter` sets the
`Retry-After` header on a rejected request. The handler carries the one monitor it consults as `handler.monitor`, so an
app that is torn down can stop its sampling.

## Options

| Option                    | Default | Description                                                                                 |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `maxEventLoopDelay`       | `false` | Largest tolerated mean event loop delay in milliseconds.                                    |
| `maxEventLoopUtilization` | `false` | Largest tolerated event loop utilization over one sample interval, a ratio between 0 and 1. |
| `maxMemoryHeapUsed`       | `false` | Largest tolerated V8 heap usage in bytes.                                                   |
| `maxMemoryRss`            | `false` | Largest tolerated resident set size in bytes.                                               |
| `sampleInterval`          | `250`   | Milliseconds between two samples.                                                           |
| `resolution`              | `10`    | Sampling rate of the event loop delay histogram in milliseconds.                            |

`false` disables a check; only the limits set are enforced.
