import type { EnqueuedJob, EnqueueOptions, JobContract, JobOptions, QueueStats } from './types.js';

/**
 * Contract every queue driver implements: a backend that takes jobs, running them inline (`local`) or handing them to
 * workers (`bullmq`).
 *
 * Declared as an ambient class rather than an interface so that `typeof QueueDriver` describes a constructor for
 * {@link QueueManager.registerDriver}; no runtime code exists behind it. The payload arrives parsed — `enqueue()`
 * checks it against the contract before the driver sees it.
 */
export declare class QueueDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param options - Driver-specific options, as given in the location's `options`.
	 */
	constructor(options: Record<string, unknown>);

	/**
	 * Take a job.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Parsed payload.
	 * @param options - Effective options: the contract's merged with the call's.
	 * @param id - Job id, derived by `enqueue()` from `unique` or `jobId`, `undefined` for a fresh one.
	 * @returns The job's identity.
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
	 * driver that runs jobs at once has nothing to count.
	 *
	 * @param queues - The queue names to report; every registered contract's queue unless given.
	 * @returns One entry per queue.
	 */
	stats?(queues?: readonly string[]): Promise<QueueStats[]>;
}
