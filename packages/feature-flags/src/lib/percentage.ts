import { createHash } from 'node:crypto';

/**
 * The bucket, 0–99, a subject lands in for a flag.
 *
 * A hash of the flag's key and the subject's id, so the answer is the same on every instance and every day, and
 * independent between flags — one subject is not in the first 10 % of every rollout at once. SHA-256 rather than the
 * polynomial `getSimpleHash()` of `@novastarter/utils`: with that one, the buckets of two keys of the same length are
 * shifted copies of each other, so two rollouts would pick related sets of subjects.
 *
 * @param key - The flag's key.
 * @param subject - The user's or the organization's id.
 * @returns The bucket.
 */
export const bucketOf = (key: string, subject: string): number => {
	// The first four bytes of the digest are as uniform as the rest and plenty for a hundred buckets
	const digest = createHash('sha256').update(`${key}:${subject}`).digest();

	return digest.readUInt32BE(0) % 100;
};

/**
 * Whether a subject falls within a rollout percentage of a flag.
 *
 * @param key - The flag's key.
 * @param subject - The user's or the organization's id.
 * @param percentage - The share, 0–100, the feature is on for.
 * @returns `true` for a subject whose bucket is below the share.
 */
export const isInRollout = (key: string, subject: string, percentage: number): boolean => {
	// The edges need no hash: nobody is in 0 %, everybody is in 100 %
	if (percentage <= 0) {
		return false;
	}

	if (percentage >= 100) {
		return true;
	}

	// Everyone else goes by their bucket, so raising the share only ever adds subjects and never swaps them
	return bucketOf(key, subject) < percentage;
};
