import { randomInt } from 'node:crypto';

/**
 * Seconds in an hour.
 *
 * @defaultValue 3600
 */
const SECONDS_IN_HOUR = 3600;

/**
 * Hourly intervals a duration is honoured at; anything else falls back to daily.
 *
 * @defaultValue 1, 2, 3, 4, 6, 8, 12
 */
const ALLOWED_HOURS: Set<number> = new Set([1, 2, 3, 4, 6, 8, 12]);

/**
 * Convert a duration in seconds into a cron expression with a random phase.
 *
 * Ported from `api/src/schedules/utils/duration-to-cron.ts` of Directus. The random second, minute and hour offset
 * spread the instances of many projects over the interval instead of stampeding at the top of the hour. The phase
 * is written as a standard range (`1-23/2`) rather than the original's `1/2`, which croner does not accept.
 *
 * - Honoured intervals (hours): 1, 2, 3, 4, 6, 8, 12.
 * - Random hour offset within `[0, hours)` spreads load across phase groups.
 * - Any duration outside the intervals falls back to daily.
 *
 * @param duration - Seconds between runs.
 * @returns A six-field expression (with seconds).
 *
 * @example
 * ```ts
 * durationToCron(3600); // '17 42 *\/1 * * *' — every hour at a random minute and second
 * durationToCron(7200); // '17 42 1-23/2 * * *' — every 2h, phase offset 0 or 1
 * durationToCron(25200); // '17 42 9 * * *' — daily fallback
 * ```
 */
export function durationToCron(duration: number): string {
	// 1. A random phase inside the minute; `randomInt` takes an exclusive upper bound, hence 60 for 0–59
	const second = randomInt(0, 60);
	const minute = randomInt(0, 60);

	// 2. Whole hours only, and only the intervals that divide a day evenly, so the rule repeats identically every day
	if (duration > 0 && duration % SECONDS_IN_HOUR === 0) {
		const hours = duration / SECONDS_IN_HOUR;

		if (ALLOWED_HOURS.has(hours)) {
			// 3. hours=1 has no phase offset so default to `*/1`; a phase is written as the standard `offset-23/hours`
			//    range — the `offset/hours` shorthand of the original is a non-standard stepping croner rejects
			const offset = hours === 1 ? '*' : `${randomInt(0, hours)}-23`;
			return `${second} ${minute} ${offset}/${hours} * * *`;
		}
	}

	// 4. Anything else runs once a day at a random hour
	const hour = randomInt(0, 24);
	return `${second} ${minute} ${hour} * * *`;
}
