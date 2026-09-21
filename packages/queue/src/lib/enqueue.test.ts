/**
 * Tests of `queue/lib/enqueue` on the local driver.
 *
 * `@novastarter/logger`, `@novastarter/emitter` and the Redis client of `@novastarter/redis` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import { defineJob } from './define-job.js';
import { enqueue, jobs, QUEUE_ENQUEUED_EVENT } from './enqueue.js';
import { _handlers, registerJobHandlers } from './handlers.js';
import { useQueue } from './use-queue.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// No Redis is opened in unit tests; the client is a stand-in
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn(() => ({ quit: vi.fn(async () => 'OK') })),
}));

const emitter = { emitAction: vi.fn() };

/**
 * A contract standing in for the application's jobs: the package registers none of its own.
 */
const testPing = defineJob({
	name: 'test.ping',
	schema: z.object({ message: z.string().default('ping'), at: z.iso.datetime().optional() }),
	options: { attempts: 1, removeOnComplete: true },
});

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ error: vi.fn() } as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
	registerJob(testPing);

	// Every test enqueues on a local default location, as an application without Redis would register it
	useQueue().registerLocation('default', {
		driver: 'local',
		options: {},
	});
});

afterEach(() => {
	useQueue.reset();
	_handlers.clear();
	_contracts.delete('test.ping');
	vi.clearAllMocks();
});

describe('enqueue', () => {
	test('Parses the payload, runs the handler and emits queue.enqueued', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.ping': handler } as never);

		const job = await enqueue('test.ping' as never, {} as never);

		expect(job).toStrictEqual({ id: expect.any(String), name: 'test.ping', queue: 'test' });
		expect(handler).toHaveBeenCalledWith({ message: 'ping' }, expect.objectContaining({ id: job.id, attempt: 1 }));

		expect(emitter.emitAction).toHaveBeenCalledWith(QUEUE_ENQUEUED_EVENT, { ...job, payload: { message: 'ping' } });
		expect(jobs.enqueue).toBe(enqueue);
	});

	test('Refuses an invalid payload before anything is queued', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.ping': handler } as never);

		await expect(enqueue('test.ping' as never, { at: 'yesterday' } as never)).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
		});

		expect(handler).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Applies the contract options and the call overrides, deriving the id', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.ping': handler } as never);

		const job = await enqueue('test.ping' as never, {} as never, { jobId: 'nightly' });

		expect(job.id).toBe('nightly');

		registerJob(
			defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }), options: { unique: true } }),
		);

		registerJobHandlers({ 'reports.build': handler } as never);

		const derived = await enqueue('reports.build' as never, { customer: 'c1' } as never);

		expect(derived.id).toMatch(/^reports\.build_/);
		_contracts.delete('reports.build');
	});
});
