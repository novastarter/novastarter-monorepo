/**
 * Tests of `memory/utils/compress`.
 */
import { expect, test } from 'vitest';
import { compress, decompress } from './compress.js';

/**
 * Serialized forms of every value kind the store writes — the UTF-8 bytes of their JSON — so the round trip is
 * checked on the bytes gzip really sees, not on a value.
 */
const cases: [string, Uint8Array][] = [
	['object', new Uint8Array([123, 34, 104, 101, 108, 108, 111, 34, 58, 34, 119, 111, 114, 108, 100, 34, 125])],
	['string', new Uint8Array([34, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 34])],
	['number', new Uint8Array([52, 50])],
	['boolean', new Uint8Array([116, 114, 117, 101])],
	[
		'array',
		new Uint8Array([
			91, 123, 34, 104, 101, 108, 108, 111, 34, 58, 34, 103, 111, 111, 100, 98, 121, 101, 34, 125, 44, 123, 34, 104,
			101, 108, 108, 111, 34, 58, 34, 119, 111, 114, 108, 100, 34, 125, 93,
		]),
	],
];

test.each(cases)('%s', async (_description, input) => {
	// Compressing answers with the package's array type, not with the buffer zlib produced
	const compressed = await compress(input);

	expect(compressed).toBeInstanceOf(Uint8Array);

	// Decompressing gives the original bytes back, so what was stored reads the same
	const decompressed = await decompress(compressed);

	expect(decompressed).toEqual(input);
});
