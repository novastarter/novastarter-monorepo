/**
 * Refuse a job delay that a timer could not honour.
 *
 * Shared by every driver so a delay one driver refuses is refused the same way by the others: Node silently arms
 * a 1 ms timer for a negative or `NaN` delay, so the caller who asked for a wait would get an immediate run without
 * noticing; an infinite delay would make the `local` driver re-arm its timer slices for ever, so the job would
 * silently never run.
 *
 * @param name - The job's name, for the error message.
 * @param delay - Milliseconds to wait before the job may run; a missing one means no wait.
 * @throws `RangeError` when `delay` is negative, `NaN` or not finite.
 */
export const validateJobDelay = (name: string, delay: number | undefined): void => {
	// 1. Written as `!(effective >= 0)` so a `NaN` delay fails the check too; `Number.isFinite` refuses the
	//    infinities on top, which pass `>= 0` but outrun any timer. A missing delay means no wait, which is allowed
	const effective = delay ?? 0;

	if (!(effective >= 0) || !Number.isFinite(effective)) {
		throw new RangeError(`The delay of job "${name}" must be 0 or more milliseconds, got ${effective}`);
	}
};
