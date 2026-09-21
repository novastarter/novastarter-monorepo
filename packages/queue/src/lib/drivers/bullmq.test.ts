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
import { DEFAULT_REMOVE_ON_FAIL, QueueDriverBullmq, toJobsOptions } from './bullmq.js';

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

// The driver never opens a worker; `createWorker` does, and is tested with a worker fake of its own
vi.mock('bullmq', () => ({ Queue: FakeQueue, Worker: vi.fn() }));

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
	useQueue.reset();
	FakeQueue.instances = [];
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

describe('QueueDriverBullmq', () => {
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

		const first = await driver.enqueue(contract, { value: 'a' }, contract.options, 'id-1');
		const second = await driver.enqueue(contract, { value: 'b' }, { ...contract.options, delay: 50 });

		expect(first).toStrictEqual({ id: 'id-1', name: 'test.echo', queue: 'test' });
		expect(second).toStrictEqual({ id: 'generated', name: 'test.echo', queue: 'test' });

		expect(FakeQueue.instances).toHaveLength(1);

		// 2. The queue opens with the client, the prefix and the telemetry add-on of the driver
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

		// Connection errors are logged, not thrown into the process
		FakeQueue.instances[0]!.emit('error', new Error('down'));
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Queue "test" connection error');

		await driver.close();
		expect(FakeQueue.instances[0]!.close).toHaveBeenCalled();
		expect(driver.connection.quit).toHaveBeenCalled();
	});

	test('Uses a given client as is and leaves it open', async () => {
		const client = { quit: vi.fn(async () => 'OK') };
		const driver = new QueueDriverBullmq({ connection: client as never, logger: logger as any });

		expect(createRedis).not.toHaveBeenCalled();
		expect(driver.connection).toBe(client);

		await driver.close();
		expect(client.quit).not.toHaveBeenCalled();
	});

	test('Reports the counts of the given queues, zero for the states BullMQ leaves out', async () => {
		const driver = new QueueDriverBullmq({ connection: { host: 'redis' }, logger: logger as any });

		await expect(driver.stats(['test', 'mail'])).resolves.toStrictEqual([
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

		await driver.close();
	});
});
