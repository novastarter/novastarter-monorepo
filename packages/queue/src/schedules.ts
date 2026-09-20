import type { Env } from '@novastarter/env';
import { toBoolean } from '@novastarter/utils';
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
 * Nightly hour of the retention sweep when `RETENTION_SCHEDULE` is not set: when a long delete is least likely to
 * fight with traffic.
 *
 * @defaultValue `0 3 * * *`
 */
export const DEFAULT_RETENTION_SCHEDULE = '0 3 * * *';

/**
 * Morning hour of the notification digest when `NOTIFICATIONS_DIGEST_CRON` is not set.
 *
 * @defaultValue `0 8 * * *`
 */
export const DEFAULT_DIGEST_SCHEDULE = '0 8 * * *';

/**
 * How often the abandoned resumable uploads are swept when `TUS_CLEANUP_SCHEDULE` is not set: hourly, the
 * granularity of their expiration.
 *
 * @defaultValue `0 * * * *`
 */
export const DEFAULT_TUS_CLEANUP_SCHEDULE = '0 * * * *';

/**
 * How often the development ping fires.
 *
 * @defaultValue every five minutes
 */
export const DEV_PING_SCHEDULE = '*/5 * * * *';

/**
 * The schedules of the kit; the app adds its own with {@link registerSchedule}.
 *
 * Exported as a bare array so tests can reset it in place.
 *
 * @internal
 */
export const _schedules: Schedule[] = [
	{
		job: 'retention.run',
		cron: (env) => String(env['RETENTION_SCHEDULE'] ?? DEFAULT_RETENTION_SCHEDULE),
		payload: {},
		enabled: (env) => toBoolean(env['RETENTION_ENABLED'] ?? true),
	},
	{
		job: 'notifications.digest',
		cron: (env) => String(env['NOTIFICATIONS_DIGEST_CRON'] ?? DEFAULT_DIGEST_SCHEDULE),
		payload: {},
		enabled: (env) => toBoolean(env['NOTIFICATIONS_DIGEST_ENABLED'] ?? true),
	},
	{
		job: 'tus.cleanup',
		cron: (env) => String(env['TUS_CLEANUP_SCHEDULE'] ?? DEFAULT_TUS_CLEANUP_SCHEDULE),
		payload: {},
		// Nothing to sweep while resumable uploads are off
		enabled: (env) => toBoolean(env['TUS_ENABLED'] ?? false),
	},
	{
		job: 'system.ping',
		cron: DEV_PING_SCHEDULE,
		payload: { message: 'scheduled ping' },
		// A heartbeat through the whole pipeline is worth having while developing, noise in production
		enabled: (env) => env['NODE_ENV'] === 'development',
	},
];

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
