import type { Readable } from 'node:stream';

/**
 * Check whether a value behaves like a Node `Readable` stream.
 *
 * The check is structural instead of `instanceof Readable` on purpose: a stream created by another copy of the
 * streams implementation (a bundled `readable-stream`, a different realm) does not share the `node:stream` prototype
 * chain, yet it pipes and reads exactly like a native one.
 *
 * @param input - Any value.
 * @returns `true` when `input` exposes the internals every Node readable has and has not ended.
 * @example
 * ```ts
 * if (!isReadableStream(response.Body)) {
 *     throw new Error('Expected a Node stream');
 * }
 * ```
 */
export const isReadableStream = (input: unknown): input is Readable => {
	// 1. Only a non-null object can carry stream members; anything else is rejected before its properties are read
	if (input === null || typeof input !== 'object') {
		return false;
	}

	// 2. Probe for members a Node readable always has and plain objects or Web streams lack: the piping API, the
	//    internal `_read` hook and the readable state. `readable !== false` rules out streams that already ended.
	//    The members are read through a record of unknowns, since the value is not yet known to be a stream
	const candidate = input as Record<string, unknown>;

	return (
		typeof candidate['pipe'] === 'function' &&
		typeof candidate['_read'] === 'function' &&
		typeof candidate['_readableState'] === 'object' &&
		candidate['readable'] !== false
	);
};
