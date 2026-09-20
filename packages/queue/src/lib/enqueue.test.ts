/**
 * Tests of `queue/lib/enqueue`, `use-queue` and `queue-manager` on the local provider.
 *
 * `@novastarter/logger`, `@novastarter/emitter` and the Redis client of `@novastarter/redis` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { useLogger } from '@novastarter/logger';
import { createRedis } from '@novastarter/redis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import { defineJob } from './define-job.js';
import { enqueue, JOB_ENQUEUED_EVENT, jobs } from './enqueue.js';
import { _handlers, registerJobHandlers } from './handlers.js';
import { QueueBullmq } from './providers/bullmq.js';
import { QueueLocal } from './providers/local.js';
import { QueueManager } from './queue-manager.js';
import { _cache, useQueue } from './use-queue.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// No Redis is opened in unit tests; the client is a stand-in
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn(() => ({ quit: vi.fn(async () => 'OK') })),
}));

const emitter = { emitAction: vi.fn() };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ error: vi.fn() } as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);

	// Every test enqueues on a local default location, as an application without Redis would register it
	useQueue().registerLocation('default', {
		driver: 'local',
		options: {},
	});
});

afterEach(() => {
	_cache.queue = undefined;
	_handlers.clear();
	vi.clearAllMocks();
});

describe('useQueue / QueueManager', () => {
	test('Keeps one manager per process with the built-in drivers registered', () => {
		const first = useQueue();

		expect(first).toBeInstanceOf(QueueManager);
		expect(useQueue()).toBe(first);
		expect(first.location('anything')).toBeInstanceOf(QueueLocal);
	});

	test('Builds a bullmq location on its own Redis client and closes every location', async () => {
		useQueue().registerLocation('mail', {
			driver: 'bullmq',
			options: {
				connection: 'redis://jobs',
				prefix: 'acme',
			},
		});

		const mail = useQueue().location('mail');

		expect(mail).toBeInstanceOf(QueueBullmq);
		expect(createRedis).toHaveBeenCalledWith('redis://jobs', { maxRetriesPerRequest: null });
		expect(useQueue().location('reports')).toBeInstanceOf(QueueLocal);

		await useQueue().close();
		expect((mail as QueueBullmq).connection.quit).toHaveBeenCalled();
	});

	test('Names the queue when neither its location nor the default one exists', () => {
		_cache.queue = undefined;

		expect(() => useQueue().location('mail')).toThrow('Queue "mail" has no location of its own and no "default" one.');
	});

	test('Refuses a location of a driver nobody registered', () => {
		expect(() =>
			useQueue().registerLocation('x', {
				driver: 'sqs' as 'local',
				options: {},
			}),
		).toThrow(/isn't registered/);
	});
});

describe('enqueue', () => {
	test('Parses the payload, runs the handler and emits job.enqueued', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'system.ping': handler });

		const job = await enqueue('system.ping', {});

		expect(job).toStrictEqual({ id: expect.any(String), name: 'system.ping', queue: 'system' });
		expect(handler).toHaveBeenCalledWith({ message: 'ping' }, expect.objectContaining({ id: job.id, attempt: 1 }));

		expect(emitter.emitAction).toHaveBeenCalledWith(JOB_ENQUEUED_EVENT, { ...job, payload: { message: 'ping' } });
		expect(jobs.enqueue).toBe(enqueue);
	});

	test('Refuses an invalid payload before anything is queued', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'system.ping': handler });

		await expect(enqueue('system.ping', { at: 'yesterday' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		expect(handler).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Applies the contract options and the call overrides, deriving the id', async () => {
		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'system.ping': handler });

		const job = await enqueue('system.ping', {}, { jobId: 'nightly' });

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
