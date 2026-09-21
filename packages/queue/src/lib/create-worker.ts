import { type Logger, useLogger } from '@novastarter/logger';
import { withTimeout } from '@novastarter/utils';
import type { Job, Worker, WorkerOptions } from 'bullmq';
import { getJobContract } from '../contracts/index.js';
import type { JobContext } from '../types.js';
import { QueueDriverBullmq } from './drivers/bullmq.js';
import { useQueue } from './use-queue.js';

/**
 * What runs a job on the worker side: the parsed payload and the run's context, like a `JobHandler`.
 *
 * The thin worker of the kit forwards both to the web app; a fat one calls the handler itself.
 */
export type WorkerProcessor = (payload: unknown, context: JobContext) => Promise<void>;

/**
 * What {@link createWorker} needs.
 */
export interface CreateWorkerOptions {
	/**
	 * Redis for BullMQ — an ioredis client created with `maxRetriesPerRequest: null`, or options. Unless given, the
	 * worker connects with the client of the queue's `bullmq` location in `useQueue()`, so producer and worker of one
	 * process share the connection, the prefix and the telemetry.
	 */
	connection?: WorkerOptions['connection'] | undefined;
	/** Jobs processed at once. */
	concurrency?: number | undefined;
	/** Prefix of the Redis keys, the same the producer used; the location's unless given. */
	prefix?: string | undefined;
	/** Fallback timeout in milliseconds for contracts that set none. */
	timeout?: number | undefined;
	/**
	 * BullMQ's telemetry add-on (`bullmq-otel`): every run becomes a span, continuing the trace the producer
	 * started when it enqueued with the same add-on. The location's unless given.
	 */
	telemetry?: WorkerOptions['telemetry'] | undefined;
	/** Where completions and failures are reported; the process logger unless given. */
	logger?: Logger | undefined;
}

/**
 * A running worker.
 */
export interface QueueWorker {
	/** Queue it consumes. */
	readonly queue: string;
	/** The BullMQ worker, for what the wrapper does not expose. */
	readonly worker: Worker;
	/**
	 * Stop taking jobs, let the running ones finish, close the connection — what a `SIGTERM` handler calls.
	 *
	 * @param force - Abandon running jobs instead of waiting; they will be retried by another worker.
	 */
	close(force?: boolean): Promise<void>;
}

/**
 * Error thrown when a job outlives its timeout.
 */
export class JobTimeoutError extends Error {
	/**
	 * Create the error for a job that outlived its limit.
	 *
	 * @param name - Job name.
	 * @param timeout - The limit, in milliseconds.
	 */
	constructor(name: string, timeout: number) {
		super(`Job "${name}" timed out after ${timeout} ms`);
		this.name = 'JobTimeoutError';
	}
}

/**
 * Start a BullMQ worker on one queue, running every job through the processor.
 *
 * What a worker process calls per queue it consumes. The wrapper does what every worker of the kit needs: rebuilds the job
 * name from the queue and the BullMQ job name, enforces the contract's `timeout` (BullMQ has none of its own — a
 * job that hangs would otherwise block a concurrency slot forever) and hands the processor a signal that aborts on
 * it, logs `completed` and `failed`, and closes gracefully. `bullmq` is imported here, so the producer side stays
 * free of it.
 *
 * @param queue - Queue to consume, one of `getQueueNames()`.
 * @param processor - What to do with a job.
 * @param options - Connection, concurrency, timeout, telemetry and logger.
 * @returns The running worker.
 * @throws Error when no connection is given and the queue's location is not a `bullmq` one — there is nothing to
 * consume from.
 */
export const createWorker = async (
	queue: string,
	processor: WorkerProcessor,
	options: CreateWorkerOptions = {},
): Promise<QueueWorker> => {
	// 1. `bullmq` is loaded here and not at the top of the module, so a producer that never starts a worker never
	//    pays for it; the logger falls back to the process one
	const { Worker } = await import('bullmq');
	const logger = options.logger ?? useLogger();

	// 2. Without a connection of its own the worker consumes the location the producer of this process enqueues on,
	//    which is the one place the queue's Redis, prefix and telemetry are known; any other kind of location has
	//    nothing a worker could consume from
	let location: QueueDriverBullmq | undefined;
	let connection: WorkerOptions['connection'];

	if (options.connection === undefined) {
		const driver = useQueue().location(queue);

		if (!(driver instanceof QueueDriverBullmq)) {
			throw new Error(`Queue "${queue}" is not on a "bullmq" location; a worker needs one`);
		}

		location = driver;
		connection = driver.connection;
	} else {
		connection = options.connection;
	}

	// 3. What the options leave out comes from the location, when there is one
	const prefix = options.prefix ?? location?.prefix;
	const telemetry = options.telemetry ?? location?.telemetry;

	const worker = new Worker(
		queue,
		async (job: Job) => {
			// 4. The full name is `<queue>.<action>`; an unknown one means producer and worker disagree on the contracts
			const name = `${queue}.${job.name}`;
			const contract = getJobContract(name);

			const context: JobContext = {
				id: String(job.id),
				name,
				attempt: job.attemptsMade + 1,
				enqueuedAt: new Date(job.timestamp),
			};

			// 5. The contract's timeout, then the worker's default; none means the job may take as long as it needs
			const timeout = contract.options.timeout ?? options.timeout;

			if (!timeout) {
				await processor(job.data, context);
				return;
			}

			// 6. The run is raced against the clock and told when it lost: the signal in the context aborts with the
			//    timeout error, so a processor that passes it on stops instead of finishing a job already marked failed
			//    — and retried by the contract's rules — a second time in the background
			await withTimeout((signal) => processor(job.data, { ...context, signal }), timeout, {
				error: () => new JobTimeoutError(name, timeout),
			});
		},
		{
			connection,
			...(options.concurrency ? { concurrency: options.concurrency } : {}),
			...(prefix ? { prefix } : {}),
			...(telemetry ? { telemetry } : {}),
		},
	);

	// 7. Lifecycle to the log: what ran, what failed on which attempt, and connection trouble
	worker.on('completed', (job) => {
		logger.info(`Job "${queue}.${job.name}" (${job.id}) completed`);
	});

	worker.on('failed', (job, error) => {
		if (job) {
			logger.error(error, `Job "${queue}.${job.name}" (${job.id}) failed on attempt ${job.attemptsMade}`);
		} else {
			logger.error(error, `A job of queue "${queue}" failed before it could be read`);
		}
	});

	worker.on('error', (error) => {
		logger.error(error, `Worker of queue "${queue}" error`);
	});

	return {
		queue,
		worker,
		close: async (force = false) => {
			await worker.close(force);
		},
	};
};
