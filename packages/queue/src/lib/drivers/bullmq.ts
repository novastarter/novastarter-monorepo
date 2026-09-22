import { type Logger, useLogger } from '@novastarter/logger';
import { createRedis, type RedisConfig } from '@novastarter/redis';
import type { JobsOptions, Queue, QueueOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { getQueueNames } from '../../contracts/index.js';
import type { QueueDriver } from '../../driver.js';
import type { EnqueuedJob, EnqueueOptions, JobContract, JobOptions, QueueStats } from '../../types.js';

/**
 * Options accepted by {@link QueueDriverBullmq}: the options of a `bullmq` location.
 */
export type QueueDriverBullmqConfig = {
	/**
	 * Redis for BullMQ: a connection URL, ioredis options, or a ready ioredis client. A URL or options open a client
	 * of the driver's own with `maxRetriesPerRequest: null`, what BullMQ requires; a given client is used as is and
	 * must have been created with that option.
	 */
	connection: RedisConfig | Redis;
	/** Prefix of the Redis keys; lets several projects share one Redis. */
	prefix?: string | undefined;
	/** BullMQ's telemetry add-on, when the process traces; the queues open with it. */
	telemetry?: QueueOptions['telemetry'] | undefined;
	/** Where lifecycle events are reported; the process logger unless given. */
	logger?: Logger | undefined;
};

/**
 * Whether a connection option is a ready ioredis client rather than a URL or options.
 *
 * @param connection - The `connection` option of a location.
 * @returns `true` for a client.
 */
const isRedisClient = (connection: RedisConfig | Redis): connection is Redis => {
	// 1. A client has the command methods; a URL is a string and options are a bare object without them
	return typeof connection === 'object' && connection !== null && typeof (connection as Redis).quit === 'function';
};

/**
 * Failed records kept per queue when the contract does not say; enough to inspect what went wrong.
 *
 * @defaultValue 1000
 */
export const DEFAULT_REMOVE_ON_FAIL = 1_000;

/**
 * Turn a contract's options into BullMQ's `JobsOptions`.
 *
 * Every option of `JobOptions` has a direct counterpart except `timeout` and `unique`: the first is enforced by the
 * worker (BullMQ has no per-job timeout), the second is already folded into the id by `getJobId()`.
 *
 * @param options - Effective options of the job.
 * @param id - Job id; BullMQ ignores an add whose id is queued already, which is what `unique` relies on.
 * @returns Options for `Queue.add()`.
 */
export const toJobsOptions = (options: JobOptions & EnqueueOptions, id?: string): JobsOptions => {
	const jobsOptions: JobsOptions = {};

	if (id !== undefined) jobsOptions.jobId = id;
	if (options.attempts !== undefined) jobsOptions.attempts = options.attempts;
	if (options.priority !== undefined) jobsOptions.priority = options.priority;
	if (options.delay !== undefined) jobsOptions.delay = options.delay;

	// 1. A bare number is a fixed wait; the object form is BullMQ's own
	if (typeof options.backoff === 'number') {
		jobsOptions.backoff = { type: 'fixed', delay: options.backoff };
	} else if (options.backoff !== undefined) {
		jobsOptions.backoff = options.backoff;
	}

	// 2. Completed records go by the contract; failed ones are kept in bounded numbers for inspection
	if (options.removeOnComplete !== undefined) jobsOptions.removeOnComplete = options.removeOnComplete;
	jobsOptions.removeOnFail = DEFAULT_REMOVE_ON_FAIL;

	return jobsOptions;
};

/**
 * Driver that puts jobs on Redis through BullMQ, for a worker to pick up; the driver of a `bullmq` location.
 *
 * One BullMQ `Queue` per queue name (the part of the job name before the dot), opened on first use and sharing the
 * driver's connection. `bullmq` is imported when the first job is enqueued, so the package stays optional for
 * deployments on the `local` driver.
 */
export class QueueDriverBullmq implements QueueDriver {
	/** The ioredis client every queue of the driver shares; what a worker of the same location connects with. */
	readonly connection: Redis;

	/** Prefix of the Redis keys, for a worker of the same location. */
	readonly prefix: string | undefined;

	/** BullMQ's telemetry add-on, for a worker of the same location. */
	readonly telemetry: QueueOptions['telemetry'] | undefined;

	/** Where lifecycle events and failures are reported. */
	private readonly logger: Logger;

	/** Whether the client was opened here and is therefore closed here. */
	private readonly ownsConnection: boolean;

	/** One BullMQ `Queue` per queue name, opened on the first job for that name. */
	private readonly queues: Map<string, Queue> = new Map();

	/**
	 * The queue being opened per name, while it is: concurrent first uses of one name share it instead of each
	 * opening a BullMQ `Queue` of which only the last would be kept and closed.
	 *
	 * @internal
	 */
	private readonly opening: Map<string, Promise<Queue>> = new Map();

	/** The module, loaded once on first use. */
	private bullmq: Promise<typeof import('bullmq')> | undefined;

	/**
	 * Open the driver on its Redis.
	 *
	 * @param config - Connection, prefix, telemetry and logger.
	 */
	constructor(config: QueueDriverBullmqConfig) {
		// 1. A given client belongs to whoever created it; a URL or options become a client of the driver's own,
		//    pinned to what BullMQ requires
		this.ownsConnection = !isRedisClient(config.connection);

		this.connection = isRedisClient(config.connection)
			? config.connection
			: createRedis(config.connection, { maxRetriesPerRequest: null });

		this.prefix = config.prefix;
		this.telemetry = config.telemetry;
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Add the job to its queue.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Parsed payload.
	 * @param options - Effective options.
	 * @param id - Job id from `enqueue()`.
	 * @returns The job's identity as BullMQ recorded it.
	 */
	async enqueue(
		contract: JobContract,
		payload: unknown,
		options: JobOptions & EnqueueOptions,
		id?: string,
	): Promise<EnqueuedJob> {
		const queue = await this.getQueue(contract.queue);

		// 1. The BullMQ job name is the action: workers see `send` on queue `mail`, and `getJobContract` rejoins the two
		const job = await queue.add(contract.action, payload, toJobsOptions(options, id));

		return { id: String(job.id ?? id), name: contract.name, queue: contract.queue };
	}

	/**
	 * Close every queue opened so far, and the connection when the driver opened it.
	 * @throws What the first queue that refused to close threw, after every other queue and the client closed.
	 */
	async close(): Promise<void> {
		// 1. A queue still opening — its first use awaiting the `bullmq` import — would land in the map after the
		//    close and never be closed, over a client already quit; the openings are waited for first, failed or not
		await Promise.allSettled([...this.opening.values()]);

		// 2. Every queue closes before the client does: a queue on a shared client that closed after it would fail
		//    its last commands. Every outcome is waited for, so one refusing queue does not leave the others open
		const outcomes = await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
		this.queues.clear();

		// 3. A client the caller handed in is theirs to close; one opened here would otherwise keep the process alive
		if (this.ownsConnection) {
			await this.connection.quit();
		}

		// 4. A queue that refused to close is reported once everything else is down
		const failure = outcomes.find((outcome) => outcome.status === 'rejected');

		if (failure) {
			throw failure.reason;
		}
	}

	/**
	 * How the queues stand in Redis: BullMQ's counts per state, for the admin's system page.
	 *
	 * @param queues - The queue names; every registered contract's queue unless given.
	 * @returns One entry per queue, in the given order.
	 */
	async stats(queues: readonly string[] = getQueueNames()): Promise<QueueStats[]> {
		return Promise.all(
			queues.map(async (name) => {
				// 1. A `Queue` per name, shared with `enqueue()`; the counts are one round trip each
				const queue = await this.getQueue(name);
				const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');

				return {
					name,
					counts: {
						waiting: counts['waiting'] ?? 0,
						active: counts['active'] ?? 0,
						delayed: counts['delayed'] ?? 0,
						failed: counts['failed'] ?? 0,
						completed: counts['completed'] ?? 0,
					},
				};
			}),
		);
	}

	/**
	 * The BullMQ queue for a name, opened on first use.
	 *
	 * @param name - Queue name.
	 * @returns The queue.
	 */
	private getQueue(name: string): Promise<Queue> {
		// 1. Open at most once per name: an open queue is answered with, an opening one is joined, so two `enqueue()`
		//    calls in the same tick do not each build a `Queue` and leak the one the map forgets
		const existing = this.queues.get(name);

		if (existing) return Promise.resolve(existing);

		const opening = this.opening.get(name);

		if (opening) return opening;

		const promise = this.openQueue(name).finally(() => {
			this.opening.delete(name);
		});

		this.opening.set(name, promise);

		return promise;
	}

	/**
	 * Open the BullMQ queue of a name and keep it.
	 *
	 * @param name - The queue name.
	 * @returns The queue, wired to the logger.
	 * @internal
	 */
	private async openQueue(name: string): Promise<Queue> {
		// 1. `bullmq` is loaded on first use, so a process that never opens a queue never pays for it
		const { Queue } = await this.load();

		// 2. Prefix and telemetry are only set when given: BullMQ would take an explicit `undefined` literally
		const queue = new Queue(name, {
			connection: this.connection,
			...(this.prefix ? { prefix: this.prefix } : {}),
			...(this.telemetry ? { telemetry: this.telemetry } : {}),
		});

		// 3. A queue's connection errors would otherwise crash the process as unhandled events
		queue.on('error', (error) => {
			this.logger.error(error, `Queue "${name}" connection error`);
		});

		// 4. Kept for every later use of the name, and for `close()`
		this.queues.set(name, queue);

		return queue;
	}

	/**
	 * Load `bullmq` once.
	 *
	 * @returns The module.
	 * @throws Error naming the missing package when it is not installed.
	 */
	private load(): Promise<typeof import('bullmq')> {
		this.bullmq ??= import('bullmq').catch((error: unknown) => {
			throw new Error('Queue driver "bullmq" needs the "bullmq" package: pnpm add bullmq', { cause: error });
		});

		return this.bullmq;
	}
}
