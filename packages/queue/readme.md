# `@novastarter/queue`

Background jobs for Novastarter: contracts, a client to enqueue them, providers that run them.

## Description

A job is a contract — a name, a zod schema for its payload, retry settings — that lives here, in the kit, and a handler
that lives in the module of the web app owning it. `enqueue('mail.send', payload)` checks the payload against the
contract and hands it to the provider of the job's queue: `local` runs the handler at once (development, tests),
`bullmq` puts it on Redis for a worker. Which queue runs where is registered by the application at start-up on the
`QueueManager` of `useQueue()` — a location per queue, or one `default` for all — with the options it read from its own
configuration; the package reads nothing from the environment.

## Installation

```
pnpm add @novastarter/queue
```

`bullmq` is an optional peer dependency: `pnpm add bullmq` where the `bullmq` driver or a worker runs.

## Usage

At start-up, once. A location is named after a queue — the part of a job name before the dot — and `default` takes every
queue without one of its own. The drivers `local` and `bullmq` are built in:

```ts
import { useEnv } from '@novastarter/env';
import { useQueue } from '@novastarter/queue';

const env = useEnv();
const queue = useQueue();

queue.registerLocation('default', { driver: 'local', options: {} });

queue.registerLocation('mail', {
	driver: 'bullmq',
	options: { connection: env['QUEUE_MAIL_REDIS'] as string, prefix: env['QUEUE_MAIL_PREFIX'] as string },
});

queue.registerLocation('reports', {
	driver: 'bullmq',
	options: {
		connection: { host: env['QUEUE_REPORTS_REDIS_HOST'] as string, port: env['QUEUE_REPORTS_REDIS_PORT'] as number },
		prefix: env['QUEUE_REPORTS_PREFIX'] as string,
	},
});
```

The `bullmq` options: `connection` — a Redis URL, ioredis options (a client of the provider's own is opened, with the
`maxRetriesPerRequest: null` BullMQ requires) or a ready ioredis client (used as is; `useRedis().location(…)` of
`@novastarter/redis` is one); `prefix` of the Redis keys, so several projects share one server; `telemetry`, BullMQ's
OpenTelemetry add-on. The `local` options: none. Both take a `logger`; the process logger unless given.

Anywhere later, nothing knows about servers:

```ts
import { enqueue } from '@novastarter/queue';

await enqueue('mail.send', { to: user.email, subject: 'Welcome', template: 'welcome', data: { name } }); // → 'mail'
await enqueue('retention.run', {}, { delay: 60_000, jobId: 'nightly' }); // → 'default'
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
		options: { attempts: 5, unique: true },
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
`JobsOptions` every provider honours (`local` ignores retries).

`contract.parse(payload)` is what `enqueue()` runs: an invalid payload throws `InvalidPayloadError` of
`@novastarter/errors` naming every issue, with the `FailedValidationError` extensions of `@novastarter/validation` as
`cause`.

## Configuration

The package reads nothing from the environment; the variable names are the application's. The kit's `@novastarter/env`
knows the `QUEUE_<NAME>_*` family — `QUEUE_MAIL_REDIS`, `QUEUE_MAIL_PREFIX` — so each can be given as `<VARIABLE>_FILE`
and a numeric-looking prefix stays a string.

## Adding a job

1. The contract — in the kit under `src/contracts/<queue>.ts` (with `registerJob()` in `src/contracts/index.ts` and a
   line in the `JobRegistry` augmentation there), or in the app's module: `registerJob(defineJob({ … }))` plus the
   `declare module '@novastarter/queue'` augmentation from the example above. Explicit payload types
   (`z.ZodType<Payload, Input>`) keep the declarations buildable.
2. The handler — `registerJobHandlers({ '<queue>.<action>': async (payload, context) => … })` in the module that owns
   the work, run at startup.
3. Enqueue it from anywhere with `enqueue()`; a worker consumes the queue automatically, since `getQueueNames()` reads
   the registry.

## Enqueuing

```ts
import { enqueue, registerJobHandlers } from '@novastarter/queue';

// the module owning the job registers its handler at startup…
registerJobHandlers({
	'mail.send': async (payload, { id, attempt }) => sendMail(payload),
});

// …anyone enqueues it
await enqueue('mail.send', { to: user.email, subject: 'Welcome', template: 'welcome', data: { name } });
```

`enqueue(name, payload, options)` parses the payload, derives the id (`options.jobId`, else
`<name>_<hash of the payload>` or `<name>_<unique(payload)>` for `unique` contracts, else random — never with a `:`,
which BullMQ reserves), hands the job to `useQueue().location(queue)` and emits the `job.enqueued` action with the
parsed payload. Per-call `options` override the contract's: `delay`, `priority`, `attempts`, `jobId`.

## Providers

- `local` — runs the handler in the enqueuing process: without a delay before `enqueue()` resolves, with one on a timer
  that does not keep the process alive. A failing handler is logged and not retried; a job without a handler is refused.
  The zero-config mode and what tests run on.
- `bullmq` — one BullMQ `Queue` per queue name on Redis, consumed by a worker. `bullmq` is imported on the first job.
  `location(name).stats()` reports the counts per state for an admin's read-only view.

`useQueue().close()` closes every location at shutdown: the queues and the clients the providers opened themselves.

## Worker

```ts
import { createWorker, getQueueNames } from '@novastarter/queue';

for (const queue of getQueueNames()) {
	const worker = await createWorker(queue, forwardToWeb, { concurrency: 5, timeout: 300_000 });
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

### Delivering a job to the web app

The worker of the kit runs no domain code: it posts every job to the web app, and the two sides share the contract from
this package — `INTERNAL_JOBS_PATH` (`/api/internal/jobs/`), `internalJobUrl(baseUrl, name)`, the body type
`InternalJobRequest` (`{ id, payload, attempt, enqueuedAt }`), and the `TIMESTAMP_HEADER` / `SIGNATURE_HEADER` names the
HMAC of `@novastarter/utils/node` (`signHmac` / `verifyHmac`) travels in. The worker sends the job id in
`REQUEST_ID_HEADER` (`x-request-id`, from `@novastarter/utils`), so the web app's log lines of the run carry the same id
as the worker's.

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
const running = startSchedules({ env: useEnv(), kv: useKv().location('default'), enqueue, logger: useLogger() });
process.once('SIGTERM', () => running.stop());
```

A schedule is data: a job, a cron rule (or a function reading it from the environment), a payload and a switch. The kit
ships `retention.run` on `RETENTION_SCHEDULE` (`0 3 * * *`, off with `RETENTION_ENABLED=false`), `notifications.digest`
on `NOTIFICATIONS_DIGEST_CRON` (`0 8 * * *`, off with `NOTIFICATIONS_DIGEST_ENABLED=false`) and `system.ping` every five
minutes in development. `startSchedules()` runs every enabled one through `scheduleSynchronizedJob()`: each instance of
the cluster keeps its own croner timer, and on a tick tries to advance a `SynchronizedClock` in the shared `Kv`
(`setMax`, a Lua script on Redis) to the next fire time — the first writer enqueues, the others stand down. Rules may
carry seconds (six fields); `validateCron()` checks one; `durationToCron(seconds)` turns an interval into a rule with a
random phase, so many deployments do not fire together.

### Adding a schedule

`registerSchedule({ job, cron, payload, enabled })` — in the kit's `src/schedules.ts` or in the app's module at startup.
`cron` may be a function of the environment (`(env) => String(env['BILLING_SYNC_SCHEDULE'])`) and `enabled` a switch;
the job should be `unique` if a tick could overlap a run still in progress. Nothing else: `startSchedules()` picks it
up.

## Contracts of the kit

- `mail.send` — one message: recipients, a `template` + `props` + `locale` (rendered by the handler) or a `subject` +
  `html` / `text`, a `route` (`transactional` / `marketing`) or an `instance`, `tags`. Five tries with growing waits.
- `retention.run` — the nightly sweep of expired rows; unique, one try.
- `system.ping` — logs a message; the development schedule and the smoke test of the pipeline. Its handler is the kit's
  `createSystemPingHandler({ logger? })` — one line with the id, the wait since the enqueue and the attempt — which the
  app registers with `registerJobHandlers()`.
- `billing.sync` — a provider's webhook event, normalised the way `@novastarter/payments` does (`BillingSyncEvent`:
  `checkout.completed`, `subscription.*` with a subscription, `invoice.*` with an invoice; dates as `Date` or ISO
  strings on the way in, `Date` in the handler). Enqueued by the webhook route once the signature verified, unique by
  provider and event id while queued, five tries with growing waits; the billing module's handler applies it with
  `syncSubscription()`.
- `notifications.deliver` — one notification on one channel (`inapp`, `email`, `sms`, `push`, `chat`): the type, the
  recipient (`userId`, with an `email`, `name`, `phone` or `locale` override) and the payload, as `notify()` of
  `@novastarter/notifications` queues it. Five tries with growing waits; the handler is the package's
  `createNotificationsDeliverHandler()`.
- `notifications.digest` — one digest mail per user with unread notifications, or one user's; the schedule above.
  Unique, one try; the handler is `createNotificationsDigestHandler()`.
- `tus.cleanup` — drops the resumable uploads abandoned longer ago than `TUS_UPLOAD_EXPIRATION`; the
  `TUS_CLEANUP_SCHEDULE` schedule while `TUS_ENABLED`. Unique, one try; the files module's handler.
- `contact.submitted` — a message from the contact form: name, address, subject, message, the visitor's locale, address
  and browser, the time. Three tries; the marketing module's handler mails it to the contact inbox and notifies the
  administrators.
- `search.index` — documents to add or replace in the search index and keys to remove, at most 500 of each; five tries
  with growing waits. The handler is `createSearchIndexHandler()` of `@novastarter/search`.
- `search.reindex` — a rebuild of the search index from the modules' tables, every collection or the ones named; one
  try, unique. The handler is `createSearchReindexHandler()` of `@novastarter/search`.

`getJobContract(name)`, `getJobNames()` and `getQueueNames()` read the registry — the last is what `ENABLED_QUEUES` of
the worker is checked against.
