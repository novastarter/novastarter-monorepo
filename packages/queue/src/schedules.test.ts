/**
 * Tests of `queue/schedules`, the registry; starting them is tested in `lib/start-schedules.test.ts`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { _schedules, getSchedules, registerSchedule } from './schedules.js';
import type { ScheduleEnv } from './types.js';

afterEach(() => {
	_schedules.splice(0, _schedules.length);
});

describe('getSchedules', () => {
	test('Starts empty and resolves a rule and a switch against the environment', () => {
		// The package ships no schedule of its own; the application registers every one
		expect(getSchedules({})).toStrictEqual([]);

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

		// The rule may be a function of the environment too
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
