# `@novastarter/queue`

Background jobs for Novastarter: contracts, a client to enqueue them, drivers that run them.

## Installation

```
pnpm add @novastarter/queue
```

`bullmq` is an optional peer dependency: `pnpm add bullmq` where the `bullmq` driver or a worker runs.

## Usage

At start-up, once. A location is named after a queue — the part of a job name before the dot — and `default` takes every
queue without one of its own. The drivers `local` and `bullmq` are built in; `env` is the app's typed configuration —
the zod schema of the `@novastarter/env` readme.

```ts
import { useQueue } from '@novastarter/queue';
import { env } from './env';

const queue = useQueue();

queue.registerLocation('default', {
	driver: 'local',
	options: {},
});

queue.registerLocation('mail', {
	driver: 'bullmq',
	options: {
		connection: env.QUEUE_MAIL_REDIS,
		prefix: env.QUEUE_MAIL_PREFIX,
	},
});

queue.registerLocation('reports', {
	driver: 'bullmq',
	options: {
		connection: {
			host: env.QUEUE_REPORTS_REDIS_HOST,
			port: env.QUEUE_REPORTS_REDIS_PORT,
		},
		prefix: env.QUEUE_REPORTS_PREFIX,
	},
});
```

The `bullmq` options: `connection` — a Redis URL, ioredis options (a client of the driver's own is opened, with the
`maxRetriesPerRequest: null` BullMQ requires) or a ready ioredis client (used as is; `useRedis().location(…)` of
`@novastarter/redis` is one); `prefix` of the Redis keys, so several projects share one server; `telemetry`, BullMQ's
OpenTelemetry add-on. The `local` options: none. Both take a `logger`; the process logger unless given.

Anywhere later, nothing knows about servers:

```ts
import { enqueue } from '@novastarter/queue';

await enqueue('mail.send', {
	to: user.email,
	subject: 'Welcome',
	template: 'welcome',
	data: {
		name,
	},
}); // → 'mail'
await enqueue(
	'reports.build',
	{ customer: 'c1' },
	{
		delay: 60_000,
		jobId: 'nightly',
	},
); // → 'default'
```

Declaring a job:

```ts
import { defineJob, registerJob } from '@novastarter/queue';
import { z } from 'zod';

// packages or modules declare their jobs…
export const reportsBuild = registerJob(
	defineJob({
		name: 'reports.build',
		schema: z.object({ customer: z.string() }),
		options: {
			attempts: 5,
			unique: true,
		},
	}),
);

// …and tell the type registry about them, so `enqueue()` and `JobHandlers` know the payload
declare module '@novastarter/queue' {
	interface JobRegistry {
		'reports.build': typeof reportsBuild;
	}
}
```

A job name is `<queue>.<action>`; the queue is everything before the dot and is what a location and a worker are named
after. Options: `attempts`, `backoff`, `priority`, `removeOnComplete`, `timeout`, `unique` — the subset of BullMQ's
`JobsOptions` every driver honours (`local` ignores retries).

`contract.parse(payload)` is what `enqueue()` runs: an invalid payload throws `InvalidPayloadError` of
`@novastarter/errors` naming every issue, with the `FailedValidationError` extensions of `@novastarter/validation` as
`cause`.

## Configuration

The package reads nothing from the environment; the variable names, their defaults and their `_FILE` variants are the
application's schema's — see `@novastarter/env`.

## Adding a job

1. The contract — in the app's module: `registerJob(defineJob({ … }))` plus the `declare module '@novastarter/queue'`
   augmentation from the example above. Explicit payload types (`z.ZodType<Payload, Input>`) keep the declarations
   buildable.
2. The handler — `registerJobHandlers({ '<queue>.<action>': async (payload, context) => … })` in the module that owns
   the work, run at startup.
3. Enqueue it from anywhere with `enqueue()`; a worker consumes the queue automatically, since `getQueueNames()` reads
   the registry.

`getJobContract(name)`, `getJobNames()` and `getQueueNames()` read the registry — the last is what a worker consumes.

## Enqueuing

```ts
import { enqueue, registerJobHandlers } from '@novastarter/queue';

// the module owning the job registers its handler at startup…
registerJobHandlers({
	'mail.send': async (payload, { id, attempt }) => sendMail(payload),
});

// …anyone enqueues it
await enqueue('mail.send', {
	to: user.email,
	subject: 'Welcome',
	template: 'welcome',
	data: {
		name,
	},
});
```

`enqueue(name, payload, options)` parses the payload, derives the id (`options.jobId`, else
`<name>_<hash of the payload>` or `<name>_<unique(payload)>` for `unique` contracts, else random — never with a `:`,
which BullMQ reserves), hands the job to `useQueue().location(queue)` and emits the `queue.enqueued` action with the
parsed payload. Per-call `options` override the contract's: `delay`, `priority`, `attempts`, `jobId`.

## Drivers

- `local` — runs the handler in the enqueuing process: without a delay before `enqueue()` resolves, with one on a timer
  that does not keep the process alive. A failing handler is logged and not retried; a job without a handler is refused.
  The zero-config mode and what tests run on.
- `bullmq` — one BullMQ `Queue` per queue name on Redis, consumed by a worker. `bullmq` is imported on the first job.
  `location(name).stats()` reports the counts per state for an admin's read-only view.

`useQueue().close()` closes every location built so far at shutdown: the queues and the clients the drivers opened
themselves.

## Worker

```ts
import { createWorker, getQueueNames } from '@novastarter/queue';

for (const queue of getQueueNames()) {
	const worker = await createWorker(queue, forwardToWeb, {
		concurrency: 5,
		timeout: 300_000,
	});
	process.once('SIGTERM', () => worker.close());
}
```

`createWorker(queue, processor, options)` wraps BullMQ's `Worker`. Unless `options.connection` is given, the worker
connects with the client of the queue's `bullmq` location in `useQueue()` — the same registration as the producer's,
prefix and telemetry included — and refuses a queue on the `local` driver. The processor gets the parsed payload and a
`JobContext` (`id`, full `name`, `attempt`, `enqueuedAt`), a job outliving its contract's `timeout` (or the worker's
default) fails with `JobTimeoutError` and is retried by the contract's rules, `completed` / `failed` / `error` go to the
logger, `close(force?)` drains gracefully. `telemetry` takes BullMQ's OpenTelemetry add-on (`bullmq-otel`), on the
worker and on the `bullmq` location alike: every run becomes a span, and a producer enqueuing with the add-on hands its
trace context over in the job's metadata, so the worker's span continues the request's trace.

## Schedules

```ts
import { registerSchedule, startSchedules } from '@novastarter/queue';

registerSchedule({
	job: 'reports.build',
	cron: '0 */6 * * *',
	payload: { customer: 'all' },
	enabled: (env) => env['REPORTS_BUILD'] === true,
});

// in the worker process
const running = startSchedules({
	env,
	kv: useKv().location('default'),
	enqueue,
	logger: useLogger(),
});
process.once('SIGTERM', () => running.stop());
```

A schedule is data: a job, a cron rule (or a function reading it from the environment the application passes in), a
payload and a switch. `startSchedules()` runs every enabled one through `scheduleSynchronizedJob()`: each instance of
the cluster keeps its own croner timer, and on a tick tries to advance a `SynchronizedClock` in the shared `KvDriver`
(`setMax`, a Lua script on Redis) to the next fire time — the first writer enqueues, the others stand down. Rules may
carry seconds (six fields); `validateCron()` checks one; `durationToCron(seconds)` turns an interval into a rule with a
random phase, so many deployments do not fire together.

### Adding a schedule

`registerSchedule({ job, cron, payload, enabled })` — in the app's module at startup. `cron` may be a function of the
environment (`(env) => String(env['REPORTS_BUILD_SCHEDULE'])`) and `enabled` a switch; the job should be `unique` if a
tick could overlap a run still in progress. Nothing else: `startSchedules()` picks it up.
