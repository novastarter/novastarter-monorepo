import { randomUUID } from 'node:crypto';
import { type Logger, useLogger } from '@novastarter/logger';
import { MAX_TIMER_DELAY, toError } from '@novastarter/utils';
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
	 * Whether `close()` ran: a job enqueued afterwards would arm a timer nothing clears any more.
	 *
	 * @internal
	 */
	private closed = false;

	/**
	 * Create the driver.
	 *
	 * @param config - Logger for failures.
	 */
	constructor(config: QueueDriverLocalConfig = {}) {
		// 1. The process logger is the fallback, so a location registered with `options: {}` still reports failures
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Run the job's handler, now or after `delay`.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Validated payload, as the caller passed it; parsed here before the handler runs.
	 * @param options - Effective options; only `delay` matters here.
	 * @param id - Job id from `enqueue()`.
	 * @returns The job's identity.
	 * @throws Error when the driver is closed, or when no handler is registered for the job — silently dropping work
	 * would hide a missing module; `RangeError` for a `delay` that is negative or `NaN`.
	 */
	async enqueue(
		contract: JobContract,
		payload: unknown,
		options: JobOptions & EnqueueOptions,
		id: string = randomUUID(),
	): Promise<EnqueuedJob> {
		// 1. A closed driver takes nothing: `close()` promised that no delayed job fires after shutdown, and a timer
		//    armed now would outlive the set it was cleared from
		if (this.closed) {
			throw new Error('The local queue driver is closed');
		}

		// 2. Checked now rather than at run time, so the enqueuing request learns about a missing module
		if (!getJobHandler(contract)) {
			throw new Error(`No handler registered for job "${contract.name}"`);
		}

		// 3. A negative or `NaN` delay is refused like `sleep` refuses it: Node would arm 1 ms and run the job at once,
		//    which the caller who asked for a wait would never notice
		const delay = options.delay ?? 0;

		if (!(delay >= 0)) {
			throw new RangeError(`The delay of job "${contract.name}" must be 0 or more milliseconds, got ${delay}`);
		}

		// 4. The identity and the enqueue time are fixed now, so a delayed run reports when it was queued, not when
		//    it ran
		const job: EnqueuedJob = { id, name: contract.name, queue: contract.queue };
		const enqueuedAt = new Date();

		const run = async (): Promise<void> => {
			try {
				// 1. The same path a delivered job takes (`runJob` → `runContract`), so both parse and dispatch alike
				await runContract(contract, payload, { id, name: contract.name, attempt: 1, enqueuedAt });
			} catch (error) {
				// 2. A failing job is the handler's problem to log in detail; here it is recorded and dropped, no retries.
				//    Wrapped through `toError`, so a thrown string is not taken for the message and the job's name lost
				this.logger.error(toError(error), `Job "${contract.name}" (${id}) failed`);
			}
		};

		// 5. A delay becomes a timer that does not keep the process alive; the process ending is the queue ending
		if (delay > 0) {
			this.schedule(delay, () => void run());

			return job;
		}

		// 6. Without a delay the handler has run before the caller gets the identity back, so a test asserts right away
		await run();

		return job;
	}

	/**
	 * Cancel the delayed jobs that have not run yet.
	 */
	async close(): Promise<void> {
		// 1. Closed first, so an `enqueue()` racing the shutdown is refused rather than arming a timer after the sweep
		this.closed = true;

		// 2. Every pending timer goes, so a delayed job never fires after shutdown and nothing keeps the process alive;
		//    the set is emptied along with them, since a cleared timer is nothing to clear again
		for (const timer of this.timers) {
			clearTimeout(timer);
		}

		this.timers.clear();
	}

	/**
	 * Arm a timer for a delay of any length.
	 *
	 * @param delay - Milliseconds to wait.
	 * @param run - What to run once they passed.
	 * @internal
	 */
	private schedule(delay: number, run: () => void): void {
		// 1. A timer holds at most `MAX_TIMER_DELAY` (about 24.8 days); past that Node arms 1 ms and only warns, so the
		//    job would run at once. The wait is taken in slices instead, each armed when the previous one fires, which
		//    is how the `bullmq` driver's job waits for the same delay
		const slice = Math.min(delay, MAX_TIMER_DELAY);

		const timer = setTimeout(() => {
			// 1. A fired timer is nothing to clear; the next slice, when there is one, registers itself
			this.timers.delete(timer);

			if (delay > slice) {
				this.schedule(delay - slice, run);

				return;
			}

			run();
		}, slice);

		// 2. Unreferenced, so a pending job does not keep a finished process alive; kept, so `close()` can cancel it
		timer.unref();
		this.timers.add(timer);
	}
}
