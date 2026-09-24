/**
 * Tests of `queue/lib/enqueue` on the local driver.
 *
 * `@novastarter/logger`, `@novastarter/emitter` and the Redis client of `@novastarter/redis` are mocked.
 */
import { type Emitter, useEmitter } from '@novastarter/emitter';
import { type Logger, useLogger } from '@novastarter/logger';
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
	vi.mocked(useLogger).mockReturnValue({ error: vi.fn() } as unknown as Logger);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as Emitter);
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

	test('Hands the driver the payload as passed, so a schema transform runs once, at the run', async () => {
		// 1. Parsed twice, a doubling transform would double twice and a type-changing one would fail the second parse
		registerJob(
			defineJob({
				name: 'test.shape',
				schema: z.object({ n: z.number().transform((n) => n * 2), s: z.string().transform((s) => s.length) }),
			}),
		);

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.shape': handler } as never);

		const job = await enqueue('test.shape' as never, { n: 1, s: 'abc' } as never);

		// 2. The handler sees the output of one parse; listeners see the same, since the id and the event are built
		//    from it
		expect(handler).toHaveBeenCalledWith({ n: 2, s: 3 }, expect.objectContaining({ id: job.id }));
		expect(emitter.emitAction).toHaveBeenCalledWith(QUEUE_ENQUEUED_EVENT, { ...job, payload: { n: 2, s: 3 } });
		expect(vi.mocked(useLogger)().error).not.toHaveBeenCalled();

		_contracts.delete('test.shape');
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

	test('Collapses a second enqueue of the same unique work while the first is still running', async () => {
		registerJob(
			defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }), options: { unique: true } }),
		);

		// 1. A handler held on a gate, so the first job is still running when the duplicate lands
		let release!: () => void;

		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const handler = vi.fn(async () => {
			await gate;
		});

		registerJobHandlers({ 'reports.build': handler } as never);

		const firstRun = enqueue('reports.build' as never, { customer: 'c1' } as never);
		const secondRun = enqueue('reports.build' as never, { customer: 'c1' } as never);

		// 2. The duplicate answers the first job's identity and the handler runs only once; the gate opens only after
		//    both enqueues were accepted, so a driver without deduplication runs the handler a second time and fails the
		//    count below instead of blocking on the gate
		release();
		const [first, second] = await Promise.all([firstRun, secondRun]);

		expect(second).toStrictEqual(first);
		expect(handler).toHaveBeenCalledTimes(1);

		// 3. Once the run settled, the same work can be enqueued again
		await enqueue('reports.build' as never, { customer: 'c1' } as never);
		expect(handler).toHaveBeenCalledTimes(2);

		_contracts.delete('reports.build');
	});
});
