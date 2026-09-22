/**
 * Tests of `queue/lib/drivers/local` with handlers registered in the process registry; the registry itself is tested
 * in `handlers.test.ts`.
 */
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../define-job.js';
import { _handlers, registerJobHandlers } from '../handlers.js';
import { QueueDriverLocal } from './local.js';

const logger = { error: vi.fn() };
const contract = defineJob({ name: 'test.echo', schema: z.object({ value: z.string() }) });
let queue: QueueDriverLocal;

beforeEach(() => {
	queue = new QueueDriverLocal({ logger: logger as any });
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
		registerJobHandlers({ 'test.echo': handler } as any);

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
		registerJobHandlers({ 'test.double': handler } as any);

		await queue.enqueue(doubling, { n: 1 }, doubling.options, 'job-1');

		expect(handler).toHaveBeenCalledWith({ n: 2 }, expect.anything());
	});

	test('Logs a failing handler instead of throwing, and does not retry', async () => {
		const handler = vi.fn().mockRejectedValue(new Error('boom'));
		registerJobHandlers({ 'test.echo': handler } as any);

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
		registerJobHandlers({ 'test.echo': handler } as any);

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

	test('Honours a delay longer than one timer can hold instead of running the job after 1 ms', async () => {
		vi.useFakeTimers();

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.echo': handler } as any);

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
		registerJobHandlers({ 'test.echo': vi.fn(async () => {}) } as any);

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
		registerJobHandlers({ 'test.echo': handler } as any);

		await queue.close();

		await expect(queue.enqueue(contract, { value: 'late' }, { ...contract.options, delay: 10 })).rejects.toThrow(
			'The local queue driver is closed',
		);

		await vi.advanceTimersByTimeAsync(100);
		expect(handler).not.toHaveBeenCalled();
	});
});
