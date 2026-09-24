import type { KvDriver } from '@novastarter/memory';
import { Cron } from 'croner';
import { SynchronizedClock } from './synchronized-clock.js';

/**
 * A running schedule.
 */
export interface ScheduledJob {
	/**
	 * Stop firing.
	 *
	 * The cluster-wide clock is left in place: a tick that already fired stays claimed, so an instance that stops
	 * during a rolling restart cannot let a peer that is still running claim the same tick a second time.
	 */
	stop(): Promise<void>;

	/**
	 * Stop firing and forget the clock, so the next instance to start begins afresh.
	 *
	 * Only for callers that really want a fresh start — a tick that already fired becomes claimable again, so the
	 * "once per tick across every instance" guarantee does not hold across a reset.
	 */
	reset(): Promise<void>;
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
	// The clock is keyed by id and rule, so every instance of the cluster running this schedule shares it and
	// two schedules of one job on different rules do not
	const clock = new SynchronizedClock(`${id}:${rule}`, options.kv);

	// Unreferenced, so a schedule never keeps a process alive that is otherwise done; unprotected,
	// since overlapping runs are the callback's business (the queue dedupes) and croner would silently skip them;
	// a throwing callback is reported through `catch` rather than stopping the schedule
	const job = new Cron(
		rule,
		{
			mode: '5-or-6-parts',
			...(options.timezone ? { timezone: options.timezone } : {}),
			unref: true,
			protect: false,
			catch: (error) => options.onError?.(error),
		},
		async (self: Cron) => {
			// The next fire time is the ticket: the instance that writes it first runs this tick
			const next = self.nextRun();

			if (!next) return;

			// `setMax` on the shared store decides; a reading not greater than the stored one means another instance
			// already claimed this tick
			const wasSet = await clock.set(next.getTime());

			if (wasSet) {
				await callback(self.currentRun() ?? new Date());
			}
		},
	);

	// `stop` ends the timer alone, leaving the clock's reading in place — a tick already claimed stays
	// claimed, so an instance stopped mid-restart cannot let a peer re-run that tick; `reset` is the explicit opt-in
	// to a fresh start, forgetting the clock for the next instance
	return {
		stop: async () => {
			job.stop();
		},
		reset: async () => {
			job.stop();
			await clock.reset();
		},
	};
};
