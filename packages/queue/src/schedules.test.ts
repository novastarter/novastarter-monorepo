/**
 * Tests of `queue/schedules` and `lib/start-schedules` on the local `KvDriver` with croner on fake timers.
 */
import { KvDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startSchedules } from './lib/start-schedules.js';
import { _schedules, getSchedules, registerSchedule } from './schedules.js';
import type { ScheduleEnv } from './types.js';

const kv = new KvDriverLocal({});
const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
});

afterEach(async () => {
	_schedules.splice(0, _schedules.length);
	vi.useRealTimers();
	await kv.clear();
	vi.clearAllMocks();
});

describe('getSchedules', () => {
	test('Starts empty and resolves a rule and a switch against the environment', () => {
		// 1. The package ships no schedule of its own; the application registers every one
		expect(getSchedules({})).toStrictEqual([]);

		// 2. A fixed rule with a switch read from the environment
		registerSchedule({
			job: 'test.ping',
			cron: '*/5 * * * *',
			payload: { message: 'scheduled ping' },
			enabled: (env: ScheduleEnv) => env['NODE_ENV'] === 'development',
		} as never);

		expect(getSchedules({})).toStrictEqual([
			{ job: 'test.ping', cron: '*/5 * * * *', payload: { message: 'scheduled ping' }, enabled: false },
		]);

		expect(getSchedules({ NODE_ENV: 'development' })).toStrictEqual([
			{ job: 'test.ping', cron: '*/5 * * * *', payload: { message: 'scheduled ping' }, enabled: true },
		]);

		// 3. The rule may be a function of the environment too
		registerSchedule({
			job: 'test.ping',
			cron: (env: ScheduleEnv) => String(env['PING_SCHEDULE']),
			enabled: (env: ScheduleEnv) => env['PING_ENABLED'] === true,
		} as never);

		expect(getSchedules({ PING_SCHEDULE: '0 * * * *', PING_ENABLED: true })).toContainEqual({
			job: 'test.ping',
			cron: '0 * * * *',
			payload: {},
			enabled: true,
		});
	});
});

describe('registerSchedule', () => {
	test('Adds a schedule and refuses the same job on the same rule twice', () => {
		registerSchedule({ job: 'test.ping', cron: '0 * * * *', payload: { message: 'hourly' } } as never);

		expect(getSchedules({})).toContainEqual({
			job: 'test.ping',
			cron: '0 * * * *',
			payload: { message: 'hourly' },
			enabled: true,
		});

		expect(() => registerSchedule({ job: 'test.ping', cron: '0 * * * *' } as never)).toThrow('already scheduled');
	});
});

describe('startSchedules', () => {
	test('Starts the enabled schedules, skips disabled and invalid ones, enqueues on tick, stops', async () => {
		registerSchedule({ job: 'test.ping', cron: '* * * * * *', payload: { message: 'tick' } } as never);
		registerSchedule({ job: 'test.ping', cron: '0 3 * * *', enabled: () => false } as never);
		registerSchedule({ job: 'test.ping', cron: 'nonsense' } as never);

		const enqueue = vi.fn(async () => ({ id: '1', name: 'test.ping', queue: 'test' }));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as any });

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
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as any });

		await vi.advanceTimersByTimeAsync(2_000);

		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Schedule of "test.ping" failed to enqueue');

		await running.stop();
	});
});
