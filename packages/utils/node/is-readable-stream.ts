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
export const isReadableStream = (input: any): input is Readable => {
	// 1. Probe for members a Node readable always has and plain objects or Web streams lack: the piping API, the
	//    internal `_read` hook and the readable state. `readable !== false` rules out streams that already ended
	return (
		input !== null &&
		typeof input === 'object' &&
		typeof input.pipe === 'function' &&
		typeof input._read === 'function' &&
		typeof input._readableState === 'object' &&
		input.readable !== false
	);
};
