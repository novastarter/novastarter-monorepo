/**
 * Tests of `memory/utils/uint8array-to-string`.
 */
import { expect, test } from 'vitest';
import { uint8ArrayToString } from './uint8array-to-string.js';

test('Converts uint8array to string', () => {
	// The mirror of `stringToUint8Array`: the same byte values decode to the same ASCII text
	const uint8Array = new Uint8Array([104, 101, 108, 108, 111]);
	const string = 'hello';

	expect(uint8ArrayToString(uint8Array)).toEqual(string);
});
