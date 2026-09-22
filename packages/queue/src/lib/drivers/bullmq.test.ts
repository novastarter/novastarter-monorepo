/**
 * Tests of `queue/lib/drivers/bullmq` with `bullmq` and the Redis client of `@novastarter/redis` mocked; the worker
 * has its own tests in `create-worker.test.ts`.
 */
import { EventEmitter } from 'node:events';
import { createRedis } from '@novastarter/redis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../../contracts/index.js';
import { defineJob } from '../define-job.js';
import { useQueue } from '../use-queue.js';
import { DEFAULT_REMOVE_ON_FAIL, QueueDriverBullmq, toJobsOptions, WAITING_STATES } from './bullmq.js';

/**
 * Fake of BullMQ's `Queue`: records what was added.
 */
class FakeQueue extends EventEmitter {
	/** Every queue opened so far, in opening order. */
	static instances: FakeQueue[] = [];

	/** What `getJobState` answers per id; `unknown` for an id not listed, as BullMQ does for a missing record. */
	static states: Record<string, string> = {};

	/** `Queue.add()`: answers a job under the explicit id, or a generated one. */
	add = vi.fn(async (name: string, data: unknown, opts: { jobId?: string }) => ({
		id: opts.jobId ?? 'generated',
		name,
		data,
	}));

	/** `Queue.close()`: records the call. */
	close = vi.fn(async () => {});

	/** `Queue.getJobCounts()`: fixed counts, `completed` and `waiting-children` left out as BullMQ leaves out zeros. */
	getJobCounts = vi.fn(async () => ({ waiting: 3, prioritized: 2, active: 1, delayed: 0, failed: 2 }));

	/** `Queue.getJobState()`: what the test put into `states`. */
	getJobState = vi.fn(async (id: string) => FakeQueue.states[id] ?? 'unknown');

	/** `Queue.remove()`: records the call and answers as for a removed record. */
	remove = vi.fn(async () => 1);

	/**
	 * Open a queue, remembering the name and the options BullMQ was given.
	 *
	 * @param name - Queue name.
	 * @param opts - BullMQ's `QueueOptions`.
	 */
	constructor(
		public name: string,
		public opts: unknown,
	) {
		super();
		FakeQueue.instances.push(this);
	}
}

// The driver never opens a worker; `createWorker` does, and is tested with a worker fake of its own
vi.mock('bullmq', () => ({ Queue: FakeQueue, Worker: vi.fn() }));

// No Redis is opened in unit tests; the client is a stand-in that remembers what it was opened with
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn((config: unknown) => ({
		config,
		status: 'ready',
		quit: vi.fn(async () => 'OK'),
		disconnect: vi.fn(),
	})),
}));

const logger = { info: vi.fn(), error: vi.fn() };
const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }), options: { attempts: 2 } });

beforeEach(() => {
	registerJob(contract);
});

afterEach(() => {
	_contracts.delete('test.echo');
	useQueue.reset();
	FakeQueue.instances = [];
	FakeQueue.states = {};
	vi.clearAllMocks();
});

describe('toJobsOptions', () => {
	test('Maps every option BullMQ understands and keeps failed records bounded', () => {
		expect(
			toJobsOptions(
				{ attempts: 4, backoff: 500, priority: 2, delay: 100, removeOnComplete: 10, timeout: 1000 },
				'id-1',
			),
		).toStrictEqual({
			jobId: 'id-1',
			attempts: 4,
			priority: 2,
			delay: 100,
			backoff: { type: 'fixed', delay: 500 },
			removeOnComplete: 10,
			removeOnFail: DEFAULT_REMOVE_ON_FAIL,
		});

		expect(toJobsOptions({ backoff: { type: 'exponential', delay: 1000 } })).toStrictEqual({
			backoff: { type: 'exponential', delay: 1000 },
			removeOnFail: DEFAULT_REMOVE_ON_FAIL,
		});
	});

	test('Makes a unique id the deduplication key, not the record id, so a failed record does not block the next run', () => {
		// 1. A record under the derived id would be answered with by BullMQ for as long as it is kept, failed included;
		//    the deduplication key ends with the job instead
		expect(toJobsOptions({ unique: true }, 'test.echo_abc')).toStrictEqual({
			deduplication: { id: 'test.echo_abc' },
			removeOnFail: DEFAULT_REMOVE_ON_FAIL,
		});

		expect(toJobsOptions({ unique: () => 'x' }, 'test.echo_x')).toMatchObject({ deduplication: { id: 'test.echo_x' } });

		// 2. An explicit id names the record, `unique` or not
		expect(toJobsOptions({ unique: true, jobId: 'nightly' }, 'nightly')).toStrictEqual({
			jobId: 'nightly',
			removeOnFail: DEFAULT_REMOVE_ON_FAIL,
		});
	});
});

describe('QueueDriverBullmq', () => {
	test('Refuses a missing connection instead of letting ioredis pick localhost', () => {
		expect(() => new QueueDriverBullmq({ connection: undefined as never, logger: logger as any })).toThrow(
			'The bullmq queue driver needs a "connection"',
		);

		expect(createRedis).not.toHaveBeenCalled();
	});

	test('close() waits for a queue still opening, so it is closed rather than left behind', async () => {
		// The first use awaits the `bullmq` import; a close racing it must not resolve before that queue exists
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		const enqueued = driver.enqueue(contract, { value: 'a' }, contract.options, 'id-1');
		await driver.close();
		await enqueued;

		expect(FakeQueue.instances).toHaveLength(1);
		expect(FakeQueue.instances[0]!.close).toHaveBeenCalledOnce();
		expect(driver['queues'].size).toBe(0);
	});

	test('Opens one queue per name, adds the job under its action and closes them all', async () => {
		const telemetry = { tracer: {}, contextManager: {} };

		const driver = new QueueDriverBullmq({
			connection: { host: 'redis' },
			prefix: 'acme',
			telemetry: telemetry as never,
			logger: logger as any,
		});

		// 1. A URL or options open a client of the driver's own, pinned to what BullMQ requires
		expect(createRedis).toHaveBeenCalledWith({ host: 'redis' }, { maxRetriesPerRequest: null });
		expect(driver.connection).toMatchObject({ config: { host: 'redis' } });

		// 2. Two first uses in the same tick share one opening: BullMQ's `Queue` is built once, not once per call
		const [first, second] = await Promise.all([
			driver.enqueue(contract, { value: 'a' }, contract.options, 'id-1'),
			driver.enqueue(contract, { value: 'b' }, { ...contract.options, delay: 50 }),
		]);

		expect(first).toStrictEqual({ id: 'id-1', name: 'test.echo', queue: 'test' });
		expect(second).toStrictEqual({ id: 'generated', name: 'test.echo', queue: 'test' });

		expect(FakeQueue.instances).toHaveLength(1);

		// 3. The queue opens with the client, the prefix and the telemetry add-on of the driver
		expect(FakeQueue.instances[0]).toMatchObject({
			name: 'test',
			opts: { connection: driver.connection, prefix: 'acme', telemetry },
		});

		expect(FakeQueue.instances[0]!.add).toHaveBeenNthCalledWith(
			1,
			'echo',
			{ value: 'a' },
			expect.objectContaining({ jobId: 'id-1', attempts: 2 }),
		);

		expect(FakeQueue.instances[0]!.add).toHaveBeenNthCalledWith(
			2,
			'echo',
			{ value: 'b' },
			expect.objectContaining({ delay: 50 }),
		);

		// 4. Connection errors are logged, not thrown into the process
		FakeQueue.instances[0]!.emit('error', new Error('down'));
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Queue "test" connection error');

		// 5. Closing closes the queue and the client the driver opened itself
		await driver.close();
		expect(FakeQueue.instances[0]!.close).toHaveBeenCalled();
		expect(driver.connection.quit).toHaveBeenCalled();
	});

	test('Drops a finished record under an explicit id before adding, so the id runs again after a failure', async () => {
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		// 1. A record still queued is left alone: BullMQ collapses the add into it
		FakeQueue.states['nightly'] = 'waiting';
		await driver.enqueue(contract, { value: 'a' }, { ...contract.options, jobId: 'nightly' }, 'nightly');
		expect(FakeQueue.instances[0]!.remove).not.toHaveBeenCalled();

		// 2. A failed one, kept for inspection, would make the add a permanent no-op; it goes first
		FakeQueue.states['nightly'] = 'failed';
		await driver.enqueue(contract, { value: 'a' }, { ...contract.options, jobId: 'nightly' }, 'nightly');
		expect(FakeQueue.instances[0]!.remove).toHaveBeenCalledWith('nightly');

		// 3. A completed one kept by `removeOnComplete: N` likewise
		FakeQueue.states['nightly'] = 'completed';
		await driver.enqueue(contract, { value: 'a' }, { ...contract.options, jobId: 'nightly' }, 'nightly');
		expect(FakeQueue.instances[0]!.remove).toHaveBeenCalledTimes(2);

		// 4. A derived or random id never looks the record up: deduplication is BullMQ's
		await driver.enqueue(contract, { value: 'a' }, { ...contract.options, unique: true }, 'test.echo_abc');
		expect(FakeQueue.instances[0]!.getJobState).toHaveBeenCalledTimes(3);

		expect(FakeQueue.instances[0]!.add).toHaveBeenLastCalledWith(
			'echo',
			{ value: 'a' },
			expect.objectContaining({ deduplication: { id: 'test.echo_abc' } }),
		);

		await driver.close();
	});

	test('Refuses a negative or NaN delay, exactly as the local driver refuses it', async () => {
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		// 1. The same RangeError the `local` driver throws, so both locations answer a bad delay identically
		await expect(driver.enqueue(contract, { value: 'x' }, { ...contract.options, delay: -1 })).rejects.toThrow(
			RangeError,
		);

		await expect(driver.enqueue(contract, { value: 'x' }, { ...contract.options, delay: Number.NaN })).rejects.toThrow(
			'The delay of job "test.echo" must be 0 or more milliseconds, got NaN',
		);

		// 2. A refused job never reaches Redis: no queue was opened for it
		expect(FakeQueue.instances).toHaveLength(0);

		await driver.close();
	});

	test('Uses a given client as is and leaves it open', async () => {
		const client = { quit: vi.fn(async () => 'OK') };
		const driver = new QueueDriverBullmq({ connection: client as never, logger: logger as any });

		expect(createRedis).not.toHaveBeenCalled();
		expect(driver.connection).toBe(client);

		await driver.close();
		expect(client.quit).not.toHaveBeenCalled();
	});

	test('close() disconnects a client that never reached ready instead of waiting for a quit', async () => {
		// 1. `quit` sends QUIT through the command path, so a client that never connected would reconnect forever to
		//    deliver it and the close would hang; the close drops the socket with `disconnect` instead
		const quit = vi.fn(async () => 'OK');
		const disconnect = vi.fn();

		vi.mocked(createRedis).mockReturnValueOnce({ status: 'connecting', quit, disconnect } as never);

		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		await driver.close();

		expect(disconnect).toHaveBeenCalledOnce();
		expect(quit).not.toHaveBeenCalled();
	});

	test('Reports the counts of the given queues, folding prioritised work into waiting, zero for states BullMQ leaves out', async () => {
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		// 1. Three `waiting` plus two `prioritized`: a job with a priority never sits in BullMQ's `waiting` list
		await expect(driver.stats(['test', 'mail'])).resolves.toStrictEqual([
			{ name: 'test', counts: { waiting: 5, active: 1, delayed: 0, failed: 2, completed: 0 } },
			{ name: 'mail', counts: { waiting: 5, active: 1, delayed: 0, failed: 2, completed: 0 } },
		]);

		expect(FakeQueue.instances.map((queue) => queue.name)).toEqual(['test', 'mail']);

		// 2. Every state queued work can be in is asked for, not only the plain list
		expect(FakeQueue.instances[0]!.getJobCounts).toHaveBeenCalledWith(
			...WAITING_STATES,
			'active',
			'delayed',
			'failed',
			'completed',
		);

		await driver.close();
	});

	test('Refuses to enqueue or count after close(), rather than reopening a queue nothing will close', async () => {
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		await driver.enqueue(contract, { value: 'a' }, contract.options, 'id-1');
		await driver.close();

		await expect(driver.enqueue(contract, { value: 'b' }, contract.options, 'id-2')).rejects.toThrow(
			'The bullmq queue driver is closed',
		);

		await expect(driver.stats(['test'])).rejects.toThrow('The bullmq queue driver is closed');

		expect(FakeQueue.instances).toHaveLength(1);
		expect(driver['queues'].size).toBe(0);
	});
});
