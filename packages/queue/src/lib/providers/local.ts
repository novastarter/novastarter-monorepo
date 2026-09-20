import { randomUUID } from 'node:crypto';
import { useLogger } from '@novastarter/logger';
import type { Logger } from 'pino';
import type { EnqueuedJob, EnqueueOptions, JobContract, JobOptions, QueueProvider } from '../../types.js';
import { getJobHandler } from '../handlers.js';
import { runContract } from '../run-job.js';

/**
 * What the local provider needs: the options of a `local` location.
 */
export interface LocalQueueOptions {
	/** Where failures are reported; the process logger unless given. The provider never throws for a failing handler. */
	logger?: Logger | undefined;
}

/**
 * Provider that runs every job in the enqueuing process.
 *
 * The zero-config mode: no Redis, no worker. A job without a delay runs before `enqueue()` resolves, so a test can
 * assert on its effect right away; a delayed one waits on a timer that does not keep the process alive. Failures are
 * logged and not retried — retries are what BullMQ is for — and never reach the caller, exactly as with a real queue.
 */
export class QueueLocal implements QueueProvider {
	readonly type = 'local' as const;

	private readonly logger: Logger;

	/** Pending delayed jobs, cleared on close. */
	private readonly timers: Set<NodeJS.Timeout> = new Set();

	/**
	 * Create the provider.
	 *
	 * @param options - Logger for failures.
	 */
	constructor(options: LocalQueueOptions = {}) {
		this.logger = options.logger ?? useLogger();
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
				// 3. A failing job is the handler's problem to log in detail; here it is recorded and dropped, no retries
				this.logger.error(error, `Job "${contract.name}" (${id}) failed`);
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
		for (const timer of this.timers) {
			clearTimeout(timer);
		}

		this.timers.clear();
	}
}
