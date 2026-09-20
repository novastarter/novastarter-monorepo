import type { Env } from '@novastarter/env';
import type { JobInputOf } from './lib/enqueue.js';
import type { JobName } from './types.js';

/**
 * A job that runs on a cron rule.
 *
 * @typeParam Name - The scheduled job.
 */
export interface Schedule<Name extends JobName = JobName> {
	/** Which job to enqueue. */
	job: Name;
	/** Cron expression, or a function reading it from the environment. */
	cron: string | ((env: Env) => string);
	/** Payload enqueued on every tick; the job's defaults apply. */
	payload?: JobInputOf<Name>;
	/** Whether the schedule runs at all; on unless given. */
	enabled?: (env: Env) => boolean;
}

/**
 * A schedule with its rule and switch read from the environment.
 */
export interface ResolvedSchedule {
	job: JobName;
	cron: string;
	payload: unknown;
	enabled: boolean;
}

/**
 * The registered schedules — empty until the application adds its own with {@link registerSchedule}.
 *
 * Exported as a bare array so tests can reset it in place.
 *
 * @internal
 */
export const _schedules: Schedule[] = [];

/**
 * Add a schedule.
 *
 * @typeParam Name - The scheduled job.
 * @param schedule - Job, rule, payload and switch.
 * @throws Error when the same job is already scheduled on the same rule.
 */
export const registerSchedule = <Name extends JobName>(schedule: Schedule<Name>): void => {
	const duplicate = _schedules.some(
		(existing) => existing.job === schedule.job && String(existing.cron) === String(schedule.cron),
	);

	if (duplicate) {
		throw new Error(`Job "${schedule.job}" is already scheduled on that rule`);
	}

	_schedules.push(schedule as Schedule);
};

/**
 * The schedules with their rules and switches resolved against an environment.
 *
 * @param env - Environment to read.
 * @returns Every schedule, enabled or not, in registration order.
 */
export const getSchedules = (env: Env): ResolvedSchedule[] => {
	return _schedules.map((schedule) => ({
		job: schedule.job,
		cron: typeof schedule.cron === 'function' ? schedule.cron(env) : schedule.cron,
		payload: schedule.payload ?? {},
		enabled: schedule.enabled ? schedule.enabled(env) : true,
	}));
};
