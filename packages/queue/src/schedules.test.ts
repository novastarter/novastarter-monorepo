/**
 * Tests of `queue/schedules` and `lib/start-schedules` on the local `Kv` with croner on fake timers.
 */
import { createKv } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startSchedules } from './lib/start-schedules.js';
import {
	_schedules,
	DEFAULT_DIGEST_SCHEDULE,
	DEFAULT_RETENTION_SCHEDULE,
	DEFAULT_TUS_CLEANUP_SCHEDULE,
	DEV_PING_SCHEDULE,
	getSchedules,
	registerSchedule,
} from './schedules.js';

const kv = createKv({ type: 'local' });
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
	test('Resolves the kit schedules against the environment', () => {
		expect(getSchedules({})).toStrictEqual([
			{ job: 'retention.run', cron: DEFAULT_RETENTION_SCHEDULE, payload: {}, enabled: true },
			{ job: 'notifications.digest', cron: DEFAULT_DIGEST_SCHEDULE, payload: {}, enabled: true },
			{ job: 'tus.cleanup', cron: DEFAULT_TUS_CLEANUP_SCHEDULE, payload: {}, enabled: false },
			{ job: 'system.ping', cron: DEV_PING_SCHEDULE, payload: { message: 'scheduled ping' }, enabled: false },
		]);

		expect(
			getSchedules({
				RETENTION_SCHEDULE: '0 4 * * *',
				RETENTION_ENABLED: false,
				NOTIFICATIONS_DIGEST_CRON: '0 9 * * 1',
				NOTIFICATIONS_DIGEST_ENABLED: false,
				TUS_ENABLED: true,
				TUS_CLEANUP_SCHEDULE: '*/30 * * * *',
				NODE_ENV: 'development',
			}),
		).toStrictEqual([
			{ job: 'retention.run', cron: '0 4 * * *', payload: {}, enabled: false },
			{ job: 'notifications.digest', cron: '0 9 * * 1', payload: {}, enabled: false },
			{ job: 'tus.cleanup', cron: '*/30 * * * *', payload: {}, enabled: true },
			{ job: 'system.ping', cron: DEV_PING_SCHEDULE, payload: { message: 'scheduled ping' }, enabled: true },
		]);
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
		registerSchedule({ job: 'retention.run', cron: '0 3 * * *', enabled: () => false });
		registerSchedule({ job: 'mail.send', cron: 'nonsense' });

		const enqueue = vi.fn(async () => ({ id: '1', name: 'system.ping', queue: 'system' }));
		const running = startSchedules({ env: {}, kv, enqueue, logger: logger as any });

		expect(running.schedules.map((schedule) => schedule.job)).toStrictEqual(['system.ping']);
		expect(logger.debug).toHaveBeenCalledWith('Schedule of "retention.run" is disabled');
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
