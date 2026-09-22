import { randomUUID } from 'node:crypto';
import { type Logger, useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
import type { QueueDriver } from '../../driver.js';
import type { EnqueuedJob, EnqueueOptions, JobContract, JobOptions } from '../../types.js';
import { getJobHandler } from '../handlers.js';
import { runContract } from '../run-job.js';

/**
 * Options accepted by {@link QueueDriverLocal}: the options of a `local` location.
 */
export type QueueDriverLocalConfig = {
	/** Where failures are reported; the process logger unless given. The driver never throws for a failing handler. */
	logger?: Logger | undefined;
};

/**
 * Queue driver that runs every job in the enqueuing process.
 *
 * The zero-config mode: no Redis, no worker. A job without a delay runs before `enqueue()` resolves, so a test can
 * assert on its effect right away; a delayed one waits on a timer that does not keep the process alive. Failures are
 * logged and not retried — retries are what BullMQ is for — and never reach the caller, exactly as with a real queue.
 */
export class QueueDriverLocal implements QueueDriver {
	/** Where a failing handler is reported. */
	private readonly logger: Logger;

	/** Pending delayed jobs, cleared on close. */
	private readonly timers: Set<NodeJS.Timeout> = new Set();

	/**
	 * Create the driver.
	 *
	 * @param config - Logger for failures.
	 */
	constructor(config: QueueDriverLocalConfig = {}) {
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Run the job's handler, now or after `delay`.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Parsed payload.
	 * @param options - Effective options; only `delay` matters here.
	 * @param id - Job id from `enqueue()`.
	 * @returns The job's identity.
	 * @throws Error when no handler is registered for the job — silently dropping work would hide a missing module.
	 */
	async enqueue(
		contract: JobContract,
		payload: unknown,
		options: JobOptions & EnqueueOptions,
		id: string = randomUUID(),
	): Promise<EnqueuedJob> {
		// 1. Checked now rather than at run time, so the enqueuing request learns about a missing module
		if (!getJobHandler(contract)) {
			throw new Error(`No handler registered for job "${contract.name}"`);
		}

		const job: EnqueuedJob = { id, name: contract.name, queue: contract.queue };
		const enqueuedAt = new Date();

		const run = async (): Promise<void> => {
			try {
				// 2. The same path a delivered job takes (`runJob` → `runContract`), so both parse and dispatch alike
				await runContract(contract, payload, { id, name: contract.name, attempt: 1, enqueuedAt });
			} catch (error) {
				// 3. A failing job is the handler's problem to log in detail; here it is recorded and dropped, no retries.
				//    Wrapped through `toError`, so a thrown string is not taken for the message and the job's name lost
				this.logger.error(toError(error), `Job "${contract.name}" (${id}) failed`);
			}
		};

		// 4. A delay becomes a timer that does not keep the process alive; the process ending is the queue ending
		if (options.delay && options.delay > 0) {
			const timer = setTimeout(() => {
				this.timers.delete(timer);
				void run();
			}, options.delay);

			timer.unref();
			this.timers.add(timer);

			return job;
		}

		await run();

		return job;
	}

	/**
	 * Cancel the delayed jobs that have not run yet.
	 */
	async close(): Promise<void> {
		// 1. Every pending timer goes, so a delayed job never fires after shutdown and nothing keeps the process alive;
		//    the set is emptied along with them, since a cleared timer is nothing to clear again
		for (const timer of this.timers) {
			clearTimeout(timer);
		}

		this.timers.clear();
	}
}
