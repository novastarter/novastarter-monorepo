/**
 * Tests of `queue/lib/start-schedules` on the local `KvDriver` with croner on fake timers.
 *
 * `@novastarter/logger`, `@novastarter/emitter` and the Redis client of `@novastarter/redis` are mocked for the test
 * that hands the package's own `enqueue()` over.
 */
import { type Emitter, useEmitter } from '@novastarter/emitter';
import { type Logger, useLogger } from '@novastarter/logger';
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { _contracts, registerJob } from '../contracts/index.js';
import { _schedules, registerSchedule } from '../schedules.js';
import { defineJob } from './define-job.js';
import { enqueue } from './enqueue.js';
import { _handlers, registerJobHandlers } from './handlers.js';
import { startSchedules } from './start-schedules.js';
import { useQueue } from './use-queue.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// No Redis is opened in unit tests; the client is a stand-in
vi.mock('@novastarter/redis', () => ({
	createRedis: vi.fn(() => ({ quit: vi.fn(async () => 'OK') })),
}));

const kv = new KvDriverLocal({});
const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
	vi.mocked(useLogger).mockReturnValue({ error: vi.fn() } as unknown as Logger);
	vi.mocked(useEmitter).mockReturnValue({ emitAction: vi.fn() } as unknown as Emitter);
});

afterEach(async () => {
	_schedules.splice(0, _schedules.length);
	_contracts.delete('test.ping');
	_handlers.clear();
	useQueue.reset();
	vi.useRealTimers();
	await kv.clear();
	vi.clearAllMocks();
});

describe('startSchedules', () => {
	test('Starts the enabled schedules, skips disabled and invalid ones, enqueues on tick, stops', async () => {
		registerSchedule({ job: 'test.ping', cron: '* * * * * *', payload: { message: 'tick' } } as never);
		registerSchedule({ job: 'test.ping', cron: '0 3 * * *', enabled: () => false } as never);
		registerSchedule({ job: 'test.ping', cron: 'nonsense' } as never);

		const enqueue = vi.fn(async () => ({ id: '1', name: 'test.ping', queue: 'test' }));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as unknown as Logger });

		expect(running.schedules.map((schedule) => schedule.job)).toStrictEqual(['test.ping']);
		expect(logger.debug).toHaveBeenCalledWith('Schedule of "test.ping" is disabled');
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('invalid cron rule "nonsense"'));

		await vi.advanceTimersByTimeAsync(2_000);
		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(enqueue).toHaveBeenCalledWith('test.ping', { message: 'tick' });

		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringMatching(/^Schedule of "test.ping" enqueued 1 on its tick at /),
		);

		await running.stop();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(enqueue).toHaveBeenCalledTimes(2);
	});

	test('Reports an enqueue that fails without stopping the schedule', async () => {
		registerSchedule({ job: 'test.ping', cron: '* * * * * *' } as never);

		const enqueue = vi.fn().mockRejectedValue(new Error('queue down'));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as unknown as Logger });

		await vi.advanceTimersByTimeAsync(2_000);

		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Schedule of "test.ping" failed to enqueue');

		await running.stop();
	});

	test('Skips a schedule resolving to a rule another schedule of the job already took, out loud', async () => {
		// A string and a function resolving to the same rule pass `registerSchedule`, which cannot resolve the
		// function; sharing one clock, only the first would ever fire, and the second's payload would be lost
		registerSchedule({ job: 'test.ping', cron: '* * * * * *', payload: { message: 'first' } } as never);
		registerSchedule({ job: 'test.ping', cron: () => '* * * * * *', payload: { message: 'second' } } as never);

		const enqueue = vi.fn(async () => ({ id: '1', name: 'test.ping', queue: 'test' }));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as unknown as Logger });

		// Only the first is started; the second is named in the log, not silently dropped
		expect(running.schedules).toHaveLength(1);

		expect(logger.error).toHaveBeenCalledWith(
			'Schedule of "test.ping" resolves to the rule "* * * * * *" already scheduled; skipped',
		);

		await vi.advanceTimersByTimeAsync(2_000);
		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(enqueue).toHaveBeenCalledWith('test.ping', { message: 'first' });
		expect(enqueue).not.toHaveBeenCalledWith('test.ping', { message: 'second' });

		await running.stop();
	});

	test('Takes the enqueue() of the package as it is, as the readme shows', async () => {
		// The option is typed as the package's `enqueue`; a stub would not prove the readme's example compiles
		registerJob(defineJob({ name: 'test.ping', schema: z.object({ message: z.string().default('ping') }) }));

		const handler = vi.fn(async () => {});
		registerJobHandlers({ 'test.ping': handler } as never);
		useQueue().registerLocation('default', { driver: 'local', options: {} });
		registerSchedule({ job: 'test.ping', cron: '* * * * * *' } as never);

		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as unknown as Logger });

		// The empty payload of the schedule is validated on the tick, the default applied where the job runs
		await vi.advanceTimersByTimeAsync(1_000);
		expect(handler).toHaveBeenCalledWith({ message: 'ping' }, expect.objectContaining({ name: 'test.ping' }));

		await running.stop();
	});
});
