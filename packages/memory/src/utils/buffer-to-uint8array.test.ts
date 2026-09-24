/**
 * Tests of `memory/utils/buffer-to-uint8array`.
 */
import { expect, test } from 'vitest';
import { bufferToUint8Array } from './buffer-to-uint8array.js';

test('Returns Uint8Array matching Buffer', () => {
	// The view must carry the same bytes; decoding them back proves the offset into Node's buffer pool was honoured
	const text = 'Hello World';

	const buffer = Buffer.from(text);

	const arr = bufferToUint8Array(buffer);

	expect(arr).toBeInstanceOf(Uint8Array);
	expect(new TextDecoder().decode(arr)).toBe(text);
});
