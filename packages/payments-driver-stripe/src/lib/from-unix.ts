/**
 * A Stripe timestamp — seconds since the epoch, `null` when unset — as a `Date`.
 *
 * @param seconds - What Stripe sent.
 * @returns The date, or `null`.
 */
export const fromUnix = (seconds: number | null | undefined): Date | null =>
	typeof seconds === 'number' ? new Date(seconds * 1000) : null;
