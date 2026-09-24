/**
 * A Stripe timestamp — seconds since the epoch, `null` when unset — as a `Date`.
 *
 * @param seconds - What Stripe sent.
 * @returns The date, or `null`.
 */
export const fromUnix = (seconds: number | null | undefined): Date | null =>
	// Stripe counts seconds where `Date` counts milliseconds. Only a number is a real timestamp: `null` (unset) and
	// `undefined` (absent) read as `null`, so a missing time never surfaces as an `Invalid Date`.
	typeof seconds === 'number' ? new Date(seconds * 1000) : null;
