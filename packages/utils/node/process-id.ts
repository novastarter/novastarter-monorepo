import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Memoised process id, kept in an object so tests can reset it between runs.
 *
 * @internal
 */
export const _cache: { id: string | undefined } = { id: undefined };

/**
 * Return an id that is unique to the current process on the current machine.
 *
 * The id is an MD5 hash of the host name, the process id and the start time, so two processes on different hosts,
 * two processes on the same host and the same process before and after a restart all get different ids. It is
 * computed once and then reused for the lifetime of the process.
 *
 * @returns Hex-encoded hash identifying this process.
 * @example
 * ```ts
 * const origin = processId();
 *
 * bus.publish('cache-clear', { origin });
 * ```
 */
export const processId = (): string => {
	// 1. Reuse the id once it has been computed, so every caller in this process sees the same value
	if (_cache.id) return _cache.id;

	// 2. Combine host, pid and the current time: pids repeat across hosts and across restarts, time breaks that tie
	const parts = [hostname(), process.pid, new Date().getTime()];
	const hash = createHash('md5').update(parts.join(''));

	// 3. Store and hand out the hex digest
	_cache.id = hash.digest('hex');

	return _cache.id;
};
