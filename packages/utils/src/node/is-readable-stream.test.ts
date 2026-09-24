/**
 * Tests of `utils/node/is-readable-stream`: a live Node readable passes, everything else is refused.
 */
import { PassThrough, Readable } from 'node:stream';
import { expect, test } from 'vitest';
import { isReadableStream } from './is-readable-stream.js';

test('Accepts a Node Readable that has not ended', () => {
	// Both a plain readable and a duplex expose the piping API, `_read` and the readable state
	expect(isReadableStream(Readable.from(['chunk']))).toBe(true);
	expect(isReadableStream(new PassThrough())).toBe(true);
});

test('Accepts a stream-shaped object without the node:stream prototype', () => {
	// The check is structural: a stream from another copy of the streams implementation must pass although
	// `instanceof Readable` would fail
	const lookalike = {
		pipe() {},
		_read() {},
		_readableState: {},
		readable: true,
	};

	expect(isReadableStream(lookalike)).toBe(true);
});

test('Refuses a stream that has ended or been destroyed', () => {
	// `destroy()` flips `readable` to `false` at once; a stream in that state cannot be piped, so it is not a usable
	// readable any more
	const stream = Readable.from(['chunk']);

	stream.destroy();

	expect(stream.readable).toBe(false);
	expect(isReadableStream(stream)).toBe(false);
});

test('Refuses a Web ReadableStream', () => {
	// A Web stream has no `pipe` and no `_read`; it is consumed through a reader, not the Node piping API
	expect(isReadableStream(new ReadableStream())).toBe(false);
});

test('Refuses plain values and objects missing the stream internals', () => {
	// `null` is `typeof 'object'`, so it needs the explicit check; the rest lack one or more of the probed members
	expect(isReadableStream(null)).toBe(false);
	expect(isReadableStream(undefined)).toBe(false);
	expect(isReadableStream('text')).toBe(false);
	expect(isReadableStream(Buffer.from('text'))).toBe(false);
	expect(isReadableStream({})).toBe(false);
	expect(isReadableStream({ pipe() {} })).toBe(false);
	expect(isReadableStream({ pipe() {}, _read() {} })).toBe(false);
});
