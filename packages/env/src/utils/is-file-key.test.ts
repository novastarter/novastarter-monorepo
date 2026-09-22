/**
 * Tests of `env/utils/is-file-key`.
 */
import { expect, test } from 'vitest';
import { isFileKey } from './is-file-key.js';

test('Returns false if key is less than or equal to 5 in length', () => {
	// 1. `_FILE` alone is five characters and must stay a plain variable name; anything at or below the suffix
	//    length cannot name a variable
	expect(isFileKey('_FILE')).toBe(false);
	expect(isFileKey('hello')).toBe(false);
	expect(isFileKey('foo')).toBe(false);
});

test('Returns false if key does not end with _FILE', () => {
	// 1. A plain variable is not a file reference, even when it is long enough to hold the suffix
	expect(isFileKey('TEST_123')).toBe(false);
});

test('Returns true if key is longer than 5 characters and ends in _FILE', () => {
	// 1. A name with something before the suffix is the `*_FILE` form of a variable
	expect(isFileKey('TEST_123_FILE')).toBe(true);
});
