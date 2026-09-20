/**
 * Tests of `queue/lib/providers/bullmq` and `create-worker` with `bullmq` and the Redis client of
 * `@novastarter/redis` mocked.
 */
import { EventEmitter } from 'node:events';
import { createRedis } from '@novastarter/redis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../../contracts/index.js';
import { createWorker, JobTimeoutError } from '../create-worker.js';
import { defineJob } from '../define-job.js';
import { _cache, useQueue } from '../use-queue.js';
import { DEFAULT_REMOVE_ON_FAIL, QueueBullmq, toJobsOptions } from './bullmq.js';

/**
 * Fake of BullMQ's `Queue`: records what was added.
 */
class FakeQueue extends EventEmitter {
	static instances: FakeQueue[] = [];

	add = vi.fn(async (name: string, data: unknown, opts: { jobId?: string }) => ({
		id: opts.jobId ?? 'generated',
		name,
		data,
	}));

	close = vi.fn(async () => {});

	getJobCounts = vi.fn(async () => ({ waiting: 3, active: 1, delayed: 0, failed: 2 }));

	constructor(
		public name: string,
		public opts: unknown,
	) {
		super();
		FakeQueue.instances.push(this);
	}
}

/**
 * Fake of BullMQ's `Worker`: keeps the processor so a test can run it.
 */
class FakeWorker extends EventEmitter {
	static instances: FakeWorker[] = [];

	close = vi.fn(async () => {});

	constructor(
		public name: string,
		public processor: (job: unknown) => Promise<void>,
		public opts: unknown,
	) {
		super();
		FakeWorker.instances.push(this);
	}
}

vi.mock('bullmq', () => ({ Queue: FakeQueue, Worker: FakeWorker }));

// No Redis is opened in unit tests; the client is a stand-in that remembers what it was opened with
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn((config: unknown) => ({ config, quit: vi.fn(async () => 'OK') })),
}));

const logger = { info: vi.fn(), error: vi.fn() };
const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }), options: { attempts: 2 } });

beforeEach(() => {
	registerJob(contract);
});

afterEach(() => {
	_contracts.delete('test.echo');
	_cache.queue = undefined;
	FakeQueue.instances = [];
	FakeWorker.instances = [];
	vi.clearAllMocks();
});

describe('toJobsOptions', () => {
	test('Maps every option BullMQ understands and keeps failed records bounded', () => {
		expect(
			toJobsOptions(
				{ attempts: 4, backoff: 500, priority: 2, delay: 100, removeOnComplete: 10, timeout: 1000, unique: true },
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
});

describe('QueueBullmq', () => {
	test('Opens one queue per name, adds the job under its action and closes them all', async () => {
		const telemetry = { tracer: {}, contextManager: {} };

		const provider = new QueueBullmq({
			connection: { host: 'redis' },
			prefix: 'acme',
			telemetry: telemetry as never,
			logger: logger as any,
		});

		// 1. A URL or options open a client of the provider's own, pinned to what BullMQ requires
		expect(createRedis).toHaveBeenCalledWith({ host: 'redis' }, { maxRetriesPerRequest: null });
		expect(provider.connection).toMatchObject({ config: { host: 'redis' } });

		const first = await provider.enqueue(contract, { value: 'a' }, contract.options, 'id-1');
		const second = await provider.enqueue(contract, { value: 'b' }, { ...contract.options, delay: 50 });

		expect(first).toStrictEqual({ id: 'id-1', name: 'test.echo', queue: 'test' });
		expect(second).toStrictEqual({ id: 'generated', name: 'test.echo', queue: 'test' });

		expect(FakeQueue.instances).toHaveLength(1);

		// 2. The queue opens with the client, the prefix and the telemetry add-on of the provider
		expect(FakeQueue.instances[0]).toMatchObject({
			name: 'test',
			opts: { connection: provider.connection, prefix: 'acme', telemetry },
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

		// Connection errors are logged, not thrown into the process
		FakeQueue.instances[0]!.emit('error', new Error('down'));
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Queue "test" connection error');

		await provider.close();
		expect(FakeQueue.instances[0]!.close).toHaveBeenCalled();
		expect(provider.connection.quit).toHaveBeenCalled();
	});

	test('Uses a given client as is and leaves it open', async () => {
		const client = { quit: vi.fn(async () => 'OK') };
		const provider = new QueueBullmq({ connection: client as never, logger: logger as any });

		expect(createRedis).not.toHaveBeenCalled();
		expect(provider.connection).toBe(client);

		await provider.close();
		expect(client.quit).not.toHaveBeenCalled();
	});

	test('Reports the counts of the given queues, zero for the states BullMQ leaves out', async () => {
		const provider = new QueueBullmq({ connection: { host: 'redis' }, logger: logger as any });

		await expect(provider.stats(['test', 'mail'])).resolves.toStrictEqual([
			{ name: 'test', counts: { waiting: 3, active: 1, delayed: 0, failed: 2, completed: 0 } },
			{ name: 'mail', counts: { waiting: 3, active: 1, delayed: 0, failed: 2, completed: 0 } },
		]);

		expect(FakeQueue.instances.map((queue) => queue.name)).toEqual(['test', 'mail']);

		expect(FakeQueue.instances[0]!.getJobCounts).toHaveBeenCalledWith(
			'waiting',
			'active',
			'delayed',
			'failed',
			'completed',
		);

		await provider.close();
	});
});

describe('createWorker', () => {
	test('Connects with the queue location of the process when no connection is given, refusing a local one', async () => {
		const telemetry = { tracer: {}, contextManager: {} };

		useQueue().registerLocation('default', {
			driver: 'local',
			options: {
				logger: logger as any,
			},
		});

		useQueue().registerLocation('test', {
			driver: 'bullmq',
			options: {
				connection: 'redis://jobs',
				prefix: 'acme',
				telemetry: telemetry as never,
				logger: logger as any,
			},
		});

		await createWorker(
			'test',
			vi.fn(async () => {}),
			{ logger: logger as any },
		);

		// 1. The worker shares the location's client, prefix and telemetry with the producer of the process
		expect(FakeWorker.instances[0]).toMatchObject({
			name: 'test',
			opts: { connection: (useQueue().location('test') as QueueBullmq).connection, prefix: 'acme', telemetry },
		});

		await expect(
			createWorker(
				'other',
				vi.fn(async () => {}),
				{ logger: logger as any },
			),
		).rejects.toThrow('Queue "other" runs on the "local" driver; a worker needs a "bullmq" location');
	});

	test('Runs the processor with the rebuilt name and context, logging completions and failures', async () => {
		const processor = vi.fn(async () => {});

		const telemetry = { tracer: {}, contextManager: {} };

		const running = await createWorker('test', processor, {
			connection: { host: 'redis' },
			concurrency: 3,
			telemetry: telemetry as never,
			logger: logger as any,
		});

		expect(running.queue).toBe('test');

		// 1. The worker opens with the telemetry add-on, so its runs continue the producer's trace
		expect(FakeWorker.instances[0]).toMatchObject({
			name: 'test',
			opts: { connection: { host: 'redis' }, concurrency: 3, telemetry },
		});

		await FakeWorker.instances[0]!.processor({
			id: '7',
			name: 'echo',
			data: { value: 'a' },
			attemptsMade: 1,
			timestamp: 1_000,
		});

		expect(processor).toHaveBeenCalledWith(
			{ value: 'a' },
			{ id: '7', name: 'test.echo', attempt: 2, enqueuedAt: new Date(1_000) },
		);

		FakeWorker.instances[0]!.emit('completed', { id: '7', name: 'echo' });
		FakeWorker.instances[0]!.emit('failed', { id: '8', name: 'echo', attemptsMade: 2 }, new Error('boom'));
		FakeWorker.instances[0]!.emit('failed', undefined, new Error('lost'));

		expect(logger.info).toHaveBeenCalledWith('Job "test.echo" (7) completed');
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Job "test.echo" (8) failed on attempt 2');

		expect(logger.error).toHaveBeenCalledWith(
			expect.any(Error),
			'A job of queue "test" failed before it could be read',
		);

		await running.close(true);
		expect(FakeWorker.instances[0]!.close).toHaveBeenCalledWith(true);
	});

	test('Fails a job that outlives the contract timeout, or the worker default', async () => {
		vi.useFakeTimers();

		const slow = defineJob({ name: 'test.slow', schema: z.object({}), options: { timeout: 100 } });
		registerJob(slow);

		const processor = vi.fn(() => new Promise<void>(() => {}));
		await createWorker('test', processor, { connection: {}, timeout: 5_000, logger: logger as any });

		const run = FakeWorker.instances[0]!.processor({ id: '1', name: 'slow', data: {}, attemptsMade: 0, timestamp: 0 });
		const settled = run.catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(100);
		expect(await settled).toBeInstanceOf(JobTimeoutError);

		// The contract of `test.echo` sets no timeout, so the worker's default applies
		const fallback = FakeWorker.instances[0]!.processor({
			id: '2',
			name: 'echo',
			data: { value: 'x' },
			attemptsMade: 0,
			timestamp: 0,
		});

		const fallbackSettled = fallback.catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(await fallbackSettled).toMatchObject({ message: 'Job "test.echo" timed out after 5000 ms' });

		_contracts.delete('test.slow');
		vi.useRealTimers();
	});

	test('Refuses a job whose contract the worker does not know', async () => {
		await createWorker('test', vi.fn(), { connection: {}, logger: logger as any });

		await expect(
			FakeWorker.instances[0]!.processor({ id: '1', name: 'unknown', data: {}, attemptsMade: 0, timestamp: 0 }),
		).rejects.toThrow('Job "test.unknown" is not registered');
	});
});
