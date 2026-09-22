/**
 * Tests of `env/utils/remove-file-suffix`.
 */
import { expect, test } from 'vitest';
import { removeFileSuffix } from './remove-file-suffix.js';

test('Removes the last 5 characters from the given string', () => {
	// 1. `_FILE` is exactly the five characters the `*_FILE` form adds to the variable name
	expect(removeFileSuffix('TEST_123_FILE')).toBe('TEST_123');
});
