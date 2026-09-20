/**
 * Tests of `queue/lib/drivers/local` with handlers registered in the process registry.
 */
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
});

describe('registerJobHandlers', () => {
	test('Refuses a second handler for the same job', () => {
		registerJobHandlers({ 'test.echo': async () => {} } as any);

		expect(() => registerJobHandlers({ 'test.echo': async () => {} } as any)).toThrow(
			'Job "test.echo" already has a handler',
		);
	});
});
