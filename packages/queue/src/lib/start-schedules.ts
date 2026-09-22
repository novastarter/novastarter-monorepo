import type { Logger } from '@novastarter/logger';
import type { KvDriver } from '@novastarter/memory';
import { toError } from '@novastarter/utils';
import { getSchedules, type ResolvedSchedule } from '../schedules.js';
import type { EnqueuedJob, JobName, ScheduleEnv } from '../types.js';
import type { JobInputOf } from './enqueue.js';
import { type ScheduledJob, scheduleSynchronizedJob } from './schedule-synchronized-job.js';
import { validateCron } from './validate-cron.js';

/**
 * What {@link startSchedules} needs.
 */
export interface StartSchedulesOptions {
	/** Environment the rules and switches are read from. */
	env: ScheduleEnv;
	/** Store shared by the cluster for the synchronised clocks. */
	kv: KvDriver;
	/**
	 * Puts the job on the queue; `enqueue()` of the package, or a stand-in in tests. Typed as the package's own, so
	 * `enqueue` itself is assignable; the payload of a schedule is handed over as registered.
	 */
	enqueue: <Name extends JobName>(name: Name, payload: JobInputOf<Name>) => Promise<EnqueuedJob>;
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
 * What the worker process calls at start. A rule that does not parse, or one that a schedule of the same job
 * already resolved to, is logged and skipped rather than taking the worker down — the other schedules are still
 * worth running.
 *
 * @param options - Environment, shared store, enqueue function and logger.
 * @returns The running schedules and a way to stop them.
 */
export const startSchedules = (options: StartSchedulesOptions): RunningSchedules => {
	// 1. What was started, for the handle, and the job-plus-rule keys taken so far, for the duplicate check
	const { env, kv, logger } = options;
	const running: ScheduledJob[] = [];
	const started: ResolvedSchedule[] = [];
	const keys = new Set<string>();

	for (const schedule of getSchedules(env)) {
		// 2. A switched-off schedule is the deployment's choice, worth a debug line and nothing more
		if (!schedule.enabled) {
			logger.debug(`Schedule of "${schedule.job}" is disabled`);
			continue;
		}

		// 3. A bad rule is a configuration error of one schedule, not of the worker
		if (!validateCron(schedule.cron)) {
			logger.error(`Schedule of "${schedule.job}" has an invalid cron rule "${schedule.cron}"; skipped`);
			continue;
		}

		// 4. Two schedules resolving to one rule for one job — a string and a function, say, which `registerSchedule`
		//    cannot tell apart — would share one synchronised clock, and only the first to write it would ever
		//    enqueue; the second is skipped out loud rather than silently never firing
		const key = `${schedule.job}:${schedule.cron}`;

		if (keys.has(key)) {
			logger.error(`Schedule of "${schedule.job}" resolves to the rule "${schedule.cron}" already scheduled; skipped`);
			continue;
		}

		keys.add(key);

		// 5. The schedule runs on the cluster-wide clock; a tick that fails to enqueue is reported and the schedule
		//    goes on, since the next tick may well succeed
		running.push(
			scheduleSynchronizedJob(
				schedule.job,
				schedule.cron,
				async (fireDate) => {
					// 1. The payload goes as registered; `enqueue()` validates it against the contract on every tick
					const job = await options.enqueue(schedule.job, schedule.payload as JobInputOf<JobName>);

					// 2. At debug level, so a deployment can be checked for which instance won which tick
					logger.debug(`Schedule of "${schedule.job}" enqueued ${job.id} on its tick at ${fireDate.toISOString()}`);
				},
				{
					kv,
					timezone: options.timezone,
					onError: (error) => logger.error(toError(error), `Schedule of "${schedule.job}" failed to enqueue`),
				},
			),
		);

		started.push(schedule);
		logger.info(`Scheduled "${schedule.job}" on "${schedule.cron}"`);
	}

	// 6. The handle: what runs, and a stop that ends every schedule together
	return {
		schedules: started,
		stop: async () => {
			await Promise.all(running.map((job) => job.stop()));
		},
	};
};
