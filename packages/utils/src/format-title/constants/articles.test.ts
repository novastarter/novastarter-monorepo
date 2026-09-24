/**
 * Tests of `utils/format-title/constants/articles`: the invariant the lookup in `handleSpecialWords` relies on.
 */
import { expect, test } from 'vitest';
import { ARTICLES } from './articles.js';

test('Every entry is lower-case', () => {
	// 1. The lookup compares the lower-cased word against the list, so an entry with a capital could never match
	const notLowerCase = ARTICLES.filter((entry) => entry !== entry.toLowerCase());

	expect(notLowerCase).toEqual([]);
});
