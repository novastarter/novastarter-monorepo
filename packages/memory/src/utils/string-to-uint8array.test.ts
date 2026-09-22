/**
 * Tests of `memory/utils/string-to-uint8array`.
 */
import { expect, test } from 'vitest';
import { stringToUint8Array } from './string-to-uint8array.js';

test('Converts string to uint8array', () => {
	// 1. ASCII text encodes to its byte values, one per character, which pins the encoding as UTF-8
	const string = 'hello';
	const uint8Array = new Uint8Array([104, 101, 108, 108, 111]);

	expect(stringToUint8Array(string)).toEqual(uint8Array);
});
