/**
 * Tests of `memory/utils/uint8array-to-buffer`.
 */
import { expect, test } from 'vitest';
import { uint8ArrayToBuffer } from './uint8array-to-buffer.js';

test('Converts uint8array to buffer equivalent', () => {
	// The buffer carries the same bytes; it is what ioredis takes for a binary value
	const uint8Array = new Uint8Array([1, 2, 3]);
	const buffer = Buffer.from([1, 2, 3]);

	expect(uint8ArrayToBuffer(uint8Array)).toEqual(buffer);
});
