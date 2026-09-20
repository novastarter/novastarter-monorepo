import type { z } from 'zod';
import type { systemPing } from './contracts/system.js';

/**
 * How a job is retried, prioritised and cleaned up; the subset of BullMQ's `JobsOptions` every provider honours.
 *
 * The `local` provider runs the handler once and ignores the rest, which is fine for development and tests.
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
	/** Provider's id of this job instance. */
	id: string;
	/** The job's name. */
	name: string;
	/** This try, starting at 1. */
	attempt: number;
	/** When the job was put on the queue. */
	enqueuedAt: Date;
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
 * Contracts of the kit and of the app, keyed by name.
 *
 * The kit lists its own here; a module of the app adds its contracts by augmenting the interface, which is what makes
 * `enqueue('reports.build', payload)` check the payload of the app's own jobs:
 *
 * ```ts
 * declare module '@novastarter/queue' {
 * 	interface JobRegistry {
 * 		'reports.build': typeof reportsBuild;
 * 	}
 * }
 * ```
 *
 * The runtime registry is `registerJob()`; the two have to agree. The kit's own contract is listed here rather than
 * through augmentation, which would not survive the bundled declarations.
 */
export interface JobRegistry {
	'system.ping': typeof systemPing;
}

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
 * What `enqueue()` answers: enough to find the job again in logs and in the provider.
 */
export interface EnqueuedJob {
	id: string;
	name: string;
	queue: string;
}

/**
 * A backend that takes jobs: runs them inline (`local`) or hands them to workers (`bullmq`).
 *
 * The payload arrives parsed — `enqueue()` checks it against the contract before the provider sees it.
 */
export interface QueueProvider {
	/** Which backend this is. */
	readonly type: 'local' | 'bullmq';
	/**
	 * Take a job.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Parsed payload.
	 * @param options - Effective options: the contract's merged with the call's.
	 * @param id - Job id, derived by `enqueue()` from `unique` or `jobId`, `undefined` for a fresh one.
	 */
	enqueue(
		contract: JobContract,
		payload: unknown,
		options: JobOptions & EnqueueOptions,
		id?: string,
	): Promise<EnqueuedJob>;
	/**
	 * Release connections and timers; the process is shutting down.
	 */
	close(): Promise<void>;
	/**
	 * How the queues stand — jobs waiting, active, delayed, failed — for an admin's read-only view. Optional: a
	 * provider that runs jobs at once has nothing to count.
	 *
	 * @param queues - The queue names to report; every registered contract's queue unless given.
	 * @returns One entry per queue.
	 */
	stats?(queues?: readonly string[]): Promise<QueueStats[]>;
}

/**
 * How one queue stands, as {@link QueueProvider.stats} reports it.
 */
export interface QueueStats {
	/** The queue's name, `mail`. */
	name: string;
	/**
	 * Jobs by state; a provider reports the states it has. A paused queue keeps its jobs in `waiting` — BullMQ 6 has no
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
