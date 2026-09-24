/**
 * Tests of `queue/lib/drivers/local` with handlers registered in the process registry; the registry itself is tested
 * in `handlers.test.ts`.
 */
import type { Logger } from '@novastarter/logger';
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import type { JobHandlers } from '../../types.js';
import { defineJob } from '../define-job.js';
import { _handlers, registerJobHandlers } from '../handlers.js';
import { QueueDriverLocal } from './local.js';

const logger = { error: vi.fn() };
const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }) });
let queue: QueueDriverLocal;

beforeEach(() => {
	queue = new QueueDriverLocal({ logger: logger as unknown as Logger });
});

afterEach(async () => {
	await queue.close();
	_handlers.clear();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe('QueueDriverLocal', () => {
	test('Runs the handler before enqueue resolves and answers the job identity', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		const job = await queue.enqueue(contract, { value: 'x' }, contract.options, 'job-1');

		expect(job).toStrictEqual({ id: 'job-1', name: 'test.echo', queue: 'test' });

		expect(handler).toHaveBeenCalledWith(
			{ value: 'x' },
			{ id: 'job-1', name: 'test.echo', attempt: 1, enqueuedAt: expect.any(Date) },
		);
	});

	test('Parses the payload once, at the run, so a schema transform is applied a single time', async () => {
		const doubling = defineJob({ name: 'test.double', schema: z.object({ n: z.number().transform((n) => n * 2) }) });
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.double': handler } as JobHandlers);

		await queue.enqueue(doubling, { n: 1 }, doubling.options, 'job-1');

		expect(handler).toHaveBeenCalledWith({ n: 2 }, expect.anything());
	});

	test('Logs a failing handler instead of throwing, and does not retry', async () => {
		const handler = vi.fn().mockRejectedValue(new Error('boom'));
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		await expect(queue.enqueue(contract, { value: 'x' }, { ...contract.options, attempts: 5 })).resolves.toMatchObject({
			name: 'test.echo',
		});

		expect(handler).toHaveBeenCalledTimes(1);

		expect(logger.error).toHaveBeenCalledWith(
			expect.any(Error),
			expect.stringMatching(/^Job "test.echo" \(.+\) failed$/),
		);
	});

	test('Refuses a job nobody handles', async () => {
		await expect(queue.enqueue(contract, { value: 'x' }, contract.options)).rejects.toThrow(
			'No handler registered for job "test.echo"',
		);
	});

	test('Delays a job on a timer that close() cancels', async () => {
		vi.useFakeTimers();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		await queue.enqueue(contract, { value: 'later' }, { ...contract.options, delay: 1_000 });
		await queue.enqueue(contract, { value: 'never' }, { ...contract.options, delay: 5_000 });

		expect(handler).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1_000);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ value: 'later' }, expect.anything());

		await queue.close();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test('Collapses a second enqueue of the same id into the running job, answering the first identity', async () => {
		// 1. A handler held on a gate, so the first job is still running when the duplicate lands; without a delay the
		//    handler runs inline, so it has been called by the time `enqueue()` returns its promise
		let release!: () => void;

		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const handler = vi.fn(async () => {
			await gate;
		});

		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		const firstRun = queue.enqueue(contract, { value: 'x' }, contract.options, 'job-1');
		expect(handler).toHaveBeenCalledTimes(1);

		// 2. The duplicate lands while the first is still running; the gate opens only after both enqueues were accepted,
		//    so a driver without deduplication runs the handler a second time and fails the count below instead of
		//    blocking on the gate
		const secondRun = queue.enqueue(contract, { value: 'y' }, contract.options, 'job-1');
		release();

		const [first, second] = await Promise.all([firstRun, secondRun]);

		expect(second).toStrictEqual(first);
		expect(handler).toHaveBeenCalledTimes(1);

		// 3. Once the run settles, the id is free again and the same work runs a second time
		await queue.enqueue(contract, { value: 'z' }, contract.options, 'job-1');
		expect(handler).toHaveBeenCalledTimes(2);
	});

	test('Collapses a second enqueue of the same id while the first waits on its delay, and frees the id once it ran', async () => {
		vi.useFakeTimers();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		// 1. The delayed job holds its id until its timer fires; the duplicate collapses into it instead of arming a
		//    timer of its own
		const first = await queue.enqueue(contract, { value: 'later' }, { ...contract.options, delay: 1_000 }, 'job-1');
		const second = await queue.enqueue(contract, { value: 'never' }, { ...contract.options, delay: 5_000 }, 'job-1');

		expect(second).toStrictEqual(first);
		expect(handler).not.toHaveBeenCalled();

		// 2. The delayed job runs once the wait passed; advancing past the duplicate's own delay runs nothing more,
		//    since the duplicate armed no timer
		await vi.advanceTimersByTimeAsync(1_000);
		expect(handler).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(handler).toHaveBeenCalledTimes(1);

		// 3. Settled means the id can be used again
		const third = await queue.enqueue(contract, { value: 'again' }, contract.options, 'job-1');

		expect(third).toStrictEqual(first);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	test('Honours a delay longer than one timer can hold instead of running the job after 1 ms', async () => {
		vi.useFakeTimers();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		// 1. A day past the 32-bit limit: Node would fire a single timer after 1 ms, with a warning nobody reads
		const delay = MAX_TIMER_DELAY + 24 * 3_600_000;
		await queue.enqueue(contract, { value: 'far' }, { ...contract.options, delay });

		await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY);
		expect(handler).not.toHaveBeenCalled();

		// 2. The remainder is a timer of its own, armed when the first slice fired
		await vi.advanceTimersByTimeAsync(24 * 3_600_000);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ value: 'far' }, expect.anything());
	});

	test('Refuses a negative or NaN delay, which a timer would turn into no delay', async () => {
		registerJobHandlers({ 'test.echo': vi.fn(async () => {}) } as JobHandlers);

		await expect(queue.enqueue(contract, { value: 'x' }, { ...contract.options, delay: -1 })).rejects.toThrow(
			RangeError,
		);

		await expect(queue.enqueue(contract, { value: 'x' }, { ...contract.options, delay: Number.NaN })).rejects.toThrow(
			'The delay of job "test.echo" must be 0 or more milliseconds, got NaN',
		);
	});

	test('Refuses a job after close(), so nothing fires after the shutdown', async () => {
		vi.useFakeTimers();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as JobHandlers);

		await queue.close();

		await expect(queue.enqueue(contract, { value: 'late' }, { ...contract.options, delay: 10 })).rejects.toThrow(
			'The local queue driver is closed',
		);

		await vi.advanceTimersByTimeAsync(100);
		expect(handler).not.toHaveBeenCalled();
	});
});
