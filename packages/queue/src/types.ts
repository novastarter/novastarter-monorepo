import type { z } from 'zod';

/**
 * How a job is retried, prioritised and cleaned up; the subset of BullMQ's `JobsOptions` every driver honours.
 *
 * The `local` driver runs the handler once and ignores the rest, which is fine for development and tests.
 */
export interface JobOptions {
	/** Total tries including the first one. */
	attempts?: number;
	/** Wait between tries: a fixed number of milliseconds, or growing from `delay` on every failure. */
	backoff?: number | { type: 'fixed' | 'exponential'; delay: number };
	/** Lower runs first; BullMQ's semantics, `0` being the highest. */
	priority?: number;
	/** Drop the record once done: always, or keep the last N. */
	removeOnComplete?: boolean | number;
	/** Milliseconds a run may take before the worker gives up on it. */
	timeout?: number;
	/**
	 * Collapse duplicates: `true` derives the job id from the payload, a function computes it — a second enqueue with
	 * the same id while the first is still queued is a no-op. The value must not contain `:`, which BullMQ reserves.
	 */
	unique?: boolean | ((payload: any) => string);
}

/**
 * Everything a job is, apart from its handler: the name, the queue it goes to, the shape of its payload and how it
 * runs.
 *
 * @typeParam Name - The job's name, `<queue>.<action>`.
 * @typeParam Schema - Zod schema of the payload.
 */
export interface JobContract<Name extends string = string, Schema extends z.ZodType = z.ZodType> {
	/** `<queue>.<action>`, e.g. `mail.send`. */
	name: Name;
	/** Part of the name before the dot; one BullMQ queue per value. */
	queue: string;
	/** Part of the name after the dot. */
	action: string;
	/** Zod schema the payload is checked against on enqueue. */
	schema: Schema;
	/** Retry and priority settings. */
	options: JobOptions;
	/**
	 * Check a payload against the schema.
	 *
	 * @param payload - Whatever the caller passed.
	 * @returns The parsed payload, defaults applied.
	 * @throws InvalidPayloadError listing every issue.
	 */
	parse(payload: unknown): z.output<Schema>;
}

/**
 * Payload of a contract as the caller passes it — before defaults and transforms.
 */
export type JobInput<Contract extends JobContract> = z.input<Contract['schema']>;

/**
 * Payload of a contract as the handler receives it — after parsing.
 */
export type JobPayload<Contract extends JobContract> = z.output<Contract['schema']>;

/**
 * What a handler learns about the run besides the payload.
 */
export interface JobContext {
	/** Driver's id of this job instance. */
	id: string;
	/** The job's name. */
	name: string;
	/** This try, starting at 1. */
	attempt: number;
	/** When the job was put on the queue. */
	enqueuedAt: Date;
	/**
	 * Aborted when the run outlives the contract's `timeout`, with the timeout error as reason.
	 *
	 * Only a worker with a timeout sets it. A handler passes it on to what takes a signal — `fetch`, an SDK call, a
	 * `sleep` — so a run that is already marked failed stops instead of finishing in the background and doing its
	 * work a second time when the retry runs.
	 */
	signal?: AbortSignal | undefined;
}

/**
 * What a module implements for a contract.
 *
 * @typeParam Contract - The contract handled.
 */
export type JobHandler<Contract extends JobContract = JobContract> = (
	payload: JobPayload<Contract>,
	context: JobContext,
) => Promise<void>;

/**
 * Contracts of the application, keyed by name.
 *
 * Empty here: a module of the application adds its contracts by augmenting the interface, which is what makes
 * `enqueue('reports.build', payload)` check the payload of the application's own jobs:
 *
 * ```ts
 * declare module '@novastarter/queue' {
 * 	interface JobRegistry {
 * 		'reports.build': typeof reportsBuild;
 * 	}
 * }
 * ```
 *
 * The runtime registry is `registerJob()`; the two have to agree.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the application
export interface JobRegistry {}

/**
 * Name of a known job.
 */
export type JobName = keyof JobRegistry & string;

/**
 * Handlers of the known jobs, keyed by name; every one is optional because the worker of one deployment may serve
 * a subset of the queues.
 */
export type JobHandlers = {
	[Name in JobName]?: JobHandler<JobRegistry[Name] extends JobContract ? JobRegistry[Name] : never>;
};

/**
 * Per-call overrides of a contract's options.
 */
export interface EnqueueOptions {
	/** Milliseconds to wait before the job may run. */
	delay?: number;
	/** Lower runs first, BullMQ's semantics. */
	priority?: number;
	/** Total tries, overriding the contract. */
	attempts?: number;
	/** Explicit job id; overrides what `unique` would derive. */
	jobId?: string;
}

/**
 * What `enqueue()` answers: enough to find the job again in logs and in the driver.
 */
export interface EnqueuedJob {
	id: string;
	name: string;
	queue: string;
}

/**
 * How one queue stands, as {@link QueueDriver.stats} reports it.
 */
export interface QueueStats {
	/** The queue's name, `mail`. */
	name: string;
	/**
	 * Jobs by state; a driver reports the states it has. A paused queue keeps its jobs in `waiting` — BullMQ 6 has no
	 * separate state for them.
	 */
	counts: {
		waiting: number;
		active: number;
		delayed: number;
		failed: number;
		completed: number;
	};
}

/**
 * Variables a schedule reads its cron rule and its switch from.
 *
 * Structurally the `Env` of `@novastarter/env`; kept local so the queue does not depend on that package for one
 * type, and so an application can pass any bag of settings.
 */
export type ScheduleEnv = Record<string, unknown>;
