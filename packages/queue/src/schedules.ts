import type { JobInputOf } from './lib/enqueue.js';
import type { JobName, ScheduleEnv } from './types.js';

/**
 * A job that runs on a cron rule.
 *
 * @typeParam Name - The scheduled job.
 */
export interface Schedule<Name extends JobName = JobName> {
	/** Which job to enqueue. */
	job: Name;
	/** Cron expression, or a function reading it from the environment. */
	cron: string | ((env: ScheduleEnv) => string);
	/** Payload enqueued on every tick; the job's defaults apply. */
	payload?: JobInputOf<Name>;
	/** Whether the schedule runs at all; on unless given. */
	enabled?: (env: ScheduleEnv) => boolean;
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
 * A rule given as a function is only known once resolved against the environment, so two schedules that resolve
 * to one rule for one job are caught by `startSchedules()`, which skips the second, rather than here.
 *
 * @typeParam Name - The scheduled job.
 * @param schedule - Job, rule, payload and switch.
 * @throws Error when the same job is already scheduled on the same rule.
 */
export const registerSchedule = <Name extends JobName>(schedule: Schedule<Name>): void => {
	// Job and rule together are the identity of a schedule: its synchronised clock is keyed by both, so two
	// schedules sharing them would share one ticket and only one would ever fire. The rule is compared as
	// written; a function is compared by its source, the best that can be done before the environment is known
	const duplicate = _schedules.some(
		(existing) => existing.job === schedule.job && String(existing.cron) === String(schedule.cron),
	);

	if (duplicate) {
		throw new Error(`Job "${schedule.job}" is already scheduled on that rule`);
	}

	// Registration order is start order, which the logs of `startSchedules()` follow
	_schedules.push(schedule as Schedule);
};

/**
 * The schedules with their rules and switches resolved against an environment.
 *
 * @param env - Environment to read.
 * @returns Every schedule, enabled or not, in registration order.
 */
export const getSchedules = (env: ScheduleEnv): ResolvedSchedule[] => {
	// The rule and the switch are read now, against the environment of this process, so a schedule can be turned
	// on or re-timed per deployment without a code change; a missing payload is an empty one, which the job's
	// schema fills with its defaults
	return _schedules.map((schedule) => ({
		job: schedule.job,
		cron: typeof schedule.cron === 'function' ? schedule.cron(env) : schedule.cron,
		payload: schedule.payload ?? {},
		enabled: schedule.enabled ? schedule.enabled(env) : true,
	}));
};
