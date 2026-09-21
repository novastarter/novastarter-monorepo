import type { KvDriver } from '@novastarter/memory';
import { Cron } from 'croner';
import { SynchronizedClock } from './synchronized-clock.js';

/**
 * A running schedule.
 */
export interface ScheduledJob {
	/**
	 * Stop firing and forget the clock.
	 */
	stop(): Promise<void>;
}

/**
 * Options of {@link scheduleSynchronizedJob}.
 */
export interface ScheduleSynchronizedJobOptions {
	/** Store shared by every instance of the cluster; the clock lives there. */
	kv: KvDriver;
	/** IANA time zone the rule is read in; the process's unless given. */
	timezone?: string | undefined;
	/** Where a failing callback is reported; a throw would otherwise stop the schedule. */
	onError?: ((error: unknown) => void) | undefined;
}

/**
 * Run a callback on a cron rule, once per tick across every instance of the cluster.
 *
 * Ported from `api/src/utils/schedule.ts` of Directus, on `croner` instead of `cron`. Each instance keeps its own
 * timer; on a tick it tries to advance the shared {@link SynchronizedClock} to the *next* fire time and only runs
 * the callback when it won — so a cluster of three fires once, and a lone instance fires every time. The rule may
 * carry seconds (six fields).
 *
 * @param id - What the schedule is for; with the rule, the key of the clock.
 * @param rule - Cron expression.
 * @param callback - What to run; gets the fire time.
 * @param options - Shared store, time zone, error reporting.
 * @returns A handle to stop the schedule.
 * @throws Error for a rule croner cannot parse.
 *
 * @example
 * ```ts
 * const nightly = scheduleSynchronizedJob('retention.run', '0 3 * * *', () => enqueue('retention.run', {}), { kv });
 * process.once('SIGTERM', () => nightly.stop());
 * ```
 */
export const scheduleSynchronizedJob = (
	id: string,
	rule: string,
	callback: (fireDate: Date) => void | Promise<void>,
	options: ScheduleSynchronizedJobOptions,
): ScheduledJob => {
	const clock = new SynchronizedClock(`${id}:${rule}`, options.kv);

	const job = new Cron(
		rule,
		{
			mode: '5-or-6-parts',
			...(options.timezone ? { timezone: options.timezone } : {}),
			// 1. A schedule must not keep a process alive that is otherwise done
			unref: true,
			// 2. Overlapping runs are the callback's business (the queue dedupes); croner would silently skip them
			protect: false,
			catch: (error) => options.onError?.(error),
		},
		async (self: Cron) => {
			// 3. The next fire time is the ticket: the instance that writes it first runs this tick
			const next = self.nextRun();

			if (!next) return;

			const wasSet = await clock.set(next.getTime());

			if (wasSet) {
				await callback(self.currentRun() ?? new Date());
			}
		},
	);

	return {
		stop: async () => {
			job.stop();
			await clock.reset();
		},
	};
};
