/**
 * Tests of `utils/format-title/constants/conjunctions`: the invariant the lookup in `handleSpecialWords` relies on.
 */
import { expect, test } from 'vitest';
import { CONJUNCTIONS } from './conjunctions.js';

test('Every entry is lower-case', () => {
	// The lookup compares the lower-cased word against the list, so an entry with a capital could never match
	const notLowerCase = CONJUNCTIONS.filter((entry) => entry !== entry.toLowerCase());

	expect(notLowerCase).toEqual([]);
});
