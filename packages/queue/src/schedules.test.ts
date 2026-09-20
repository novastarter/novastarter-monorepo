/**
 * Tests of `queue/schedules` and `lib/start-schedules` on the local `Kv` with croner on fake timers.
 */
import { KvLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startSchedules } from './lib/start-schedules.js';
import { _schedules, DEV_PING_SCHEDULE, getSchedules, registerSchedule } from './schedules.js';

const kv = new KvLocal({});
const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
const kitSchedules = [..._schedules];

beforeEach(() => {
	vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
});

afterEach(async () => {
	_schedules.splice(0, _schedules.length, ...kitSchedules);
	vi.useRealTimers();
	await kv.clear();
	vi.clearAllMocks();
});

describe('getSchedules', () => {
	test('Resolves the kit schedule against the environment: the ping runs in development only', () => {
		expect(getSchedules({})).toStrictEqual([
			{ job: 'system.ping', cron: DEV_PING_SCHEDULE, payload: { message: 'scheduled ping' }, enabled: false },
		]);

		expect(getSchedules({ NODE_ENV: 'development' })).toStrictEqual([
			{ job: 'system.ping', cron: DEV_PING_SCHEDULE, payload: { message: 'scheduled ping' }, enabled: true },
		]);

		// A rule and a switch may be functions of the environment
		registerSchedule({
			job: 'system.ping',
			cron: (env) => String(env['PING_SCHEDULE']),
			enabled: (env) => env['PING_ENABLED'] === true,
		});

		expect(getSchedules({ PING_SCHEDULE: '0 * * * *', PING_ENABLED: true })).toContainEqual({
			job: 'system.ping',
			cron: '0 * * * *',
			payload: {},
			enabled: true,
		});
	});
});

describe('registerSchedule', () => {
	test('Adds a schedule and refuses the same job on the same rule twice', () => {
		registerSchedule({ job: 'system.ping', cron: '0 * * * *', payload: { message: 'hourly' } });

		expect(getSchedules({})).toContainEqual({
			job: 'system.ping',
			cron: '0 * * * *',
			payload: { message: 'hourly' },
			enabled: true,
		});

		expect(() => registerSchedule({ job: 'system.ping', cron: '0 * * * *' })).toThrow('already scheduled');
	});
});

describe('startSchedules', () => {
	test('Starts the enabled schedules, skips disabled and invalid ones, enqueues on tick, stops', async () => {
		_schedules.splice(0, _schedules.length);
		registerSchedule({ job: 'system.ping', cron: '* * * * * *', payload: { message: 'tick' } });
		registerSchedule({ job: 'system.ping', cron: '0 3 * * *', enabled: () => false });
		registerSchedule({ job: 'system.ping', cron: 'nonsense' });

		const enqueue = vi.fn(async () => ({ id: '1', name: 'system.ping', queue: 'system' }));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as any });

		expect(running.schedules.map((schedule) => schedule.job)).toStrictEqual(['system.ping']);
		expect(logger.debug).toHaveBeenCalledWith('Schedule of "system.ping" is disabled');
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('invalid cron rule "nonsense"'));

		await vi.advanceTimersByTimeAsync(2_000);
		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(enqueue).toHaveBeenCalledWith('system.ping', { message: 'tick' });

		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringMatching(/^Schedule of "system.ping" enqueued 1 on its tick at /),
		);

		await running.stop();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(enqueue).toHaveBeenCalledTimes(2);
	});

	test('Reports an enqueue that fails without stopping the schedule', async () => {
		_schedules.splice(0, _schedules.length);
		registerSchedule({ job: 'system.ping', cron: '* * * * * *' });

		const enqueue = vi.fn().mockRejectedValue(new Error('queue down'));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as any });

		await vi.advanceTimersByTimeAsync(2_000);

		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(logger.error).toHaveBeenCalledWith(expect.any(Error), 'Schedule of "system.ping" failed to enqueue');

		await running.stop();
	});
});
