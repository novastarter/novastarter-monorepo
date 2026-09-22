/**
 * Tests of `utils/format-title/constants/conjunctions`: the invariant the lookup in `handleSpecialWords` relies on.
 */
import { expect, test } from 'vitest';
import conjunctions from './conjunctions.js';

test('Every entry is lower-case', () => {
	// 1. The lookup compares the lower-cased word against the list, so an entry with a capital could never match
	const notLowerCase = conjunctions.filter((entry) => entry !== entry.toLowerCase());

	expect(notLowerCase).toEqual([]);
});
