import { type Logger, useLogger } from '@novastarter/logger';
import { createRedis, type RedisConfig } from '@novastarter/redis';
import type { JobsOptions, Queue, QueueOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { getQueueNames } from '../../contracts/index.js';
import type { QueueDriver } from '../../driver.js';
import type { EnqueuedJob, EnqueueOptions, JobContract, JobOptions, QueueStats } from '../../types.js';
import { loadBullmq } from '../load-bullmq.js';
import { validateJobDelay } from '../validate-delay.js';

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
 * The states BullMQ keeps queued work in, folded into `waiting` of {@link QueueStats}.
 *
 * A job with a `priority` waits in `prioritized`, a parent waiting for its children in `waiting-children`; only a
 * plain job sits in `waiting` itself. This driver asks BullMQ for all three and reports their sum as the one
 * `waiting` number, since the reader asks how much is waiting, not where BullMQ keeps it.
 *
 * @defaultValue `waiting`, `prioritized`, `waiting-children`
 */
export const WAITING_STATES = ['waiting', 'prioritized', 'waiting-children'] as const;

/**
 * Turn a contract's options into BullMQ's `JobsOptions`.
 *
 * Every option of `JobOptions` has a direct counterpart except `timeout` and `unique`: the first is enforced by the
 * worker (BullMQ has no per-job timeout), the second decides what the id becomes. A `unique` id is BullMQ's
 * deduplication key rather than the record's id: BullMQ drops the key when the job completes or fails for good, so
 * only queued, retrying or running work collapses — a record kept for inspection after a failure would otherwise
 * make every later enqueue of that work a silent no-op. An explicit `jobId`, and the random id of any other job, is
 * the record's id, as the caller expects to find it in the driver; {@link QueueDriverBullmq.enqueue} clears a
 * finished record under an explicit id first, for the same reason.
 *
 * @param options - Effective options of the job.
 * @param id - Job id from `getJobId()`.
 * @returns Options for `Queue.add()`.
 */
export const toJobsOptions = (options: JobOptions & EnqueueOptions, id?: string): JobsOptions => {
	const jobsOptions: JobsOptions = {};

	// 1. A derived id collapses duplicates through BullMQ's deduplication, which ends with the job; the record keeps
	//    an id of BullMQ's own. Any other id names the record, so the caller finds it by what `enqueue()` answered
	if (id !== undefined && options.unique && !options.jobId) {
		jobsOptions.deduplication = { id };
	} else if (id !== undefined) {
		jobsOptions.jobId = id;
	}

	// 2. The counterparts BullMQ takes as they are, only set when given, since it would take `undefined` literally
	if (options.attempts !== undefined) jobsOptions.attempts = options.attempts;
	if (options.priority !== undefined) jobsOptions.priority = options.priority;
	if (options.delay !== undefined) jobsOptions.delay = options.delay;

	// 3. A bare number is a fixed wait; the object form is BullMQ's own
	if (typeof options.backoff === 'number') {
		jobsOptions.backoff = { type: 'fixed', delay: options.backoff };
	} else if (options.backoff !== undefined) {
		jobsOptions.backoff = options.backoff;
	}

	// 4. Completed records go by the contract; failed ones are kept in bounded numbers for inspection
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

	/**
	 * Whether `close()` ran: a queue opened afterwards would sit in the map unclosed, over a client already quit.
	 *
	 * @internal
	 */
	private closed = false;

	/**
	 * Open the driver on its Redis.
	 *
	 * @param config - Connection, prefix, telemetry and logger.
	 * @throws Error when `connection` is missing: ioredis would silently connect to `localhost:6379` and retry forever.
	 */
	constructor(config: QueueDriverBullmqConfig) {
		// 1. A missing connection is a configuration error of the location; refused by the option's name, like every
		//    driver of the kit does, rather than left to ioredis's default of a local server
		if (!config.connection) {
			throw new Error('The bullmq queue driver needs a "connection"');
		}

		// 2. A given client belongs to whoever created it; a URL or options become a client of the driver's own,
		//    pinned to what BullMQ requires
		this.ownsConnection = !isRedisClient(config.connection);

		this.connection = isRedisClient(config.connection)
			? config.connection
			: createRedis(config.connection, { maxRetriesPerRequest: null });

		// 3. What a worker of the same location reads back, so producer and worker agree on keys and traces
		this.prefix = config.prefix;
		this.telemetry = config.telemetry;
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Add the job to its queue.
	 *
	 * @param contract - The job's contract.
	 * @param payload - Validated payload, as the caller passed it; the worker parses it.
	 * @param options - Effective options.
	 * @param id - Job id from `enqueue()`.
	 * @returns The job's identity as BullMQ recorded it: the record's id, which for a `unique` job is BullMQ's own,
	 * and the queued job's when the add collapsed into it.
	 * @throws Error when the driver is closed; `RangeError` for a `delay` that is negative, `NaN` or not finite;
	 * whatever BullMQ throws.
	 */
	async enqueue(
		contract: JobContract,
		payload: unknown,
		options: JobOptions & EnqueueOptions,
		id?: string,
	): Promise<EnqueuedJob> {
		// 1. A delay a timer could not honour — negative, `NaN` or not finite — is refused through the shared check,
		//    exactly as the `local` driver refuses it: BullMQ would take it as no delay at all, so the sibling drivers
		//    would disagree about the same job
		validateJobDelay(contract.name, options.delay);

		// 2. A `Queue` per name, shared with `stats()`; a closed driver refuses here
		const queue = await this.getQueue(contract.queue);

		// 3. An explicit id names the record, and BullMQ answers an add with whatever record it holds under that id,
		//    finished or not. A completed or failed one — kept for inspection — is dropped first, so the id can be
		//    used again once its work is done and only queued, retrying or running work collapses, as with `unique`
		if (options.jobId) {
			const state = await queue.getJobState(options.jobId);

			if (state === 'completed' || state === 'failed') {
				await queue.remove(options.jobId);
			}
		}

		// 4. The BullMQ job name is the action: workers see `send` on queue `mail`, and `getJobContract` rejoins the two
		const job = await queue.add(contract.action, payload, toJobsOptions(options, id));

		return { id: String(job.id ?? id), name: contract.name, queue: contract.queue };
	}

	/**
	 * Close every queue opened so far, and the connection when the driver opened it.
	 *
	 * @throws What the first queue that refused to close threw, after every other queue and the client closed.
	 */
	async close(): Promise<void> {
		// 1. Closed first, so an `enqueue()` racing the shutdown is refused rather than reopening a queue over a
		//    client about to quit
		this.closed = true;

		// 2. A queue still opening — its first use awaiting the `bullmq` import — would land in the map after the
		//    close and never be closed, over a client already quit; the openings are waited for first, failed or not
		await Promise.allSettled([...this.opening.values()]);

		// 3. Every queue closes before the client does: a queue on a shared client that closed after it would fail
		//    its last commands. Every outcome is waited for, so one refusing queue does not leave the others open
		const outcomes = await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
		this.queues.clear();

		// 4. A client the caller handed in is theirs to close; one opened here would otherwise keep the process alive
		if (this.ownsConnection) {
			// 1. `quit` sends QUIT through the normal command path, so a client that never reached `ready` reconnects
			//    endlessly, retrying forever by default, to deliver it and the close never resolves; a client that is
			//    not connected is dropped with `disconnect` instead, which sends nothing and waits for nothing
			if (this.connection.status !== 'ready') {
				this.connection.disconnect();
			} else {
				await this.connection.quit();
			}
		}

		// 5. A queue that refused to close is reported once everything else is down
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
	 * @throws Error when the driver is closed; whatever BullMQ throws.
	 */
	async stats(queues: readonly string[] = getQueueNames()): Promise<QueueStats[]> {
		return Promise.all(
			queues.map(async (name) => {
				// 1. A `Queue` per name, shared with `enqueue()`; the counts are one round trip each
				const queue = await this.getQueue(name);

				const counts = await queue.getJobCounts(...WAITING_STATES, 'active', 'delayed', 'failed', 'completed');

				// 2. Queued work is spread over three of BullMQ's states — a prioritised job never sits in `waiting` —
				//    and reported as one, since the reader asks how much is waiting, not where BullMQ keeps it
				const waiting = WAITING_STATES.reduce((sum, state) => sum + (counts[state] ?? 0), 0);

				return {
					name,
					counts: {
						waiting,
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
	 * @throws Error when the driver is closed: a queue opened now would never be closed.
	 */
	private getQueue(name: string): Promise<Queue> {
		// 1. Nothing opens after `close()`: the map it would land in was cleared, and the client may be gone
		if (this.closed) {
			return Promise.reject(new Error('The bullmq queue driver is closed'));
		}

		// 2. Open at most once per name: an open queue is answered with, an opening one is joined, so two `enqueue()`
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
		const { Queue } = await loadBullmq();

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
}
