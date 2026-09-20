import type { Logger } from '@novastarter/logger';
import type { Kv } from '@novastarter/memory';
import { getSchedules, type ResolvedSchedule } from '../schedules.js';
import type { EnqueuedJob, JobName, ScheduleEnv } from '../types.js';
import { type ScheduledJob, scheduleSynchronizedJob } from './schedule-synchronized-job.js';
import { validateCron } from './validate-cron.js';

/**
 * What {@link startSchedules} needs.
 */
export interface StartSchedulesOptions {
	/** Environment the rules and switches are read from. */
	env: ScheduleEnv;
	/** Store shared by the cluster for the synchronised clocks. */
	kv: Kv;
	/** Puts the job on the queue; `enqueue()` of the package, or a stand-in in tests. */
	enqueue: (name: JobName, payload: unknown) => Promise<EnqueuedJob>;
	/** Where starts, skips and failures are reported. */
	logger: Logger;
	/** IANA time zone of the rules; the process's unless given. */
	timezone?: string | undefined;
}

/**
 * The running schedules.
 */
export interface RunningSchedules {
	/** What was started. */
	readonly schedules: ResolvedSchedule[];
	/**
	 * Stop every schedule.
	 */
	stop(): Promise<void>;
}

/**
 * Start every enabled schedule: on each tick the job is enqueued, once per cluster.
 *
 * What the worker process calls at start. A rule that does not parse is logged and skipped rather than taking the worker
 * down — the other schedules are still worth running.
 *
 * @param options - Environment, shared store, enqueue function and logger.
 * @returns The running schedules and a way to stop them.
 */
export const startSchedules = (options: StartSchedulesOptions): RunningSchedules => {
	const { env, kv, logger } = options;
	const running: ScheduledJob[] = [];
	const started: ResolvedSchedule[] = [];

	for (const schedule of getSchedules(env)) {
		if (!schedule.enabled) {
			logger.debug(`Schedule of "${schedule.job}" is disabled`);
			continue;
		}

		// 1. A bad rule is a configuration error of one schedule, not of the worker
		if (!validateCron(schedule.cron)) {
			logger.error(`Schedule of "${schedule.job}" has an invalid cron rule "${schedule.cron}"; skipped`);
			continue;
		}

		running.push(
			scheduleSynchronizedJob(
				schedule.job,
				schedule.cron,
				async (fireDate) => {
					const job = await options.enqueue(schedule.job, schedule.payload);

					// 1. At debug level, so a deployment can be checked for which instance won which tick
					logger.debug(`Schedule of "${schedule.job}" enqueued ${job.id} on its tick at ${fireDate.toISOString()}`);
				},
				{
					kv,
					timezone: options.timezone,
					onError: (error) => logger.error(error, `Schedule of "${schedule.job}" failed to enqueue`),
				},
			),
		);

		started.push(schedule);
		logger.info(`Scheduled "${schedule.job}" on "${schedule.cron}"`);
	}

	return {
		schedules: started,
		stop: async () => {
			await Promise.all(running.map((job) => job.stop()));
		},
	};
};
