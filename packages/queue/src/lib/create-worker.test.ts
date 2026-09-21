/**
 * Tests of `queue/lib/create-worker` with `bullmq` and the Redis client of `@novastarter/redis` mocked.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import type { JobContext } from '../types.js';
import { createWorker, JobTimeoutError } from './create-worker.js';
import { defineJob } from './define-job.js';
import { QueueDriverBullmq } from './drivers/bullmq.js';
import { useQueue } from './use-queue.js';

/**
 * Fake of BullMQ's `Queue`: the `bullmq` location the worker falls back to opens one.
 */
class FakeQueue extends EventEmitter {
	static instances: FakeQueue[] = [];

	close = vi.fn(async () => {});

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
	useQueue.reset();
	FakeQueue.instances = [];
	FakeWorker.instances = [];
	vi.clearAllMocks();
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
			opts: { connection: (useQueue().location('test') as QueueDriverBullmq).connection, prefix: 'acme', telemetry },
		});

		await expect(
			createWorker(
				'other',
				vi.fn(async () => {}),
				{ logger: logger as any },
			),
		).rejects.toThrow('Queue "other" is not on a "bullmq" location; a worker needs one');
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

		const processor = vi.fn((_payload: unknown, _context: JobContext) => new Promise<void>(() => {}));
		await createWorker('test', processor, { connection: {}, timeout: 5_000, logger: logger as any });

		const run = FakeWorker.instances[0]!.processor({ id: '1', name: 'slow', data: {}, attemptsMade: 0, timestamp: 0 });
		const settled = run.catch((error: unknown) => error);

		// The processor gets a signal in its context, still live while the job is within its time
		const signal = processor.mock.calls[0]![1].signal!;
		expect(signal.aborted).toBe(false);

		await vi.advanceTimersByTimeAsync(100);
		const error = await settled;
		expect(error).toBeInstanceOf(JobTimeoutError);

		// On timeout the signal aborts with the same error, so a processor that passed it on stops
		expect(signal.aborted).toBe(true);
		expect(signal.reason).toBe(error);

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
