/**
 * Tests of `utils/format-title/constants/acronyms`: the invariants the lookup in `handleSpecialWords` relies on.
 */
import { expect, test } from 'vitest';
import { ACRONYMS } from './acronyms.js';
import { SPECIAL_CASE } from './special-case.js';

test('Every entry is upper-case', () => {
	// The lookup compares the upper-cased word against the list, so a mixed-case entry (`FAQs` once sat here) can
	// never match and is dead
	const mixedCase = ACRONYMS.filter((entry) => entry !== entry.toUpperCase());

	expect(mixedCase).toEqual([]);
});

test('No duplicates across acronyms and special cases', () => {
	// The special-case check runs before the acronym check, so a word in both lists would silently shadow the
	// acronym; keeping the lists disjoint makes the precedence irrelevant
	const constants = [...ACRONYMS, ...SPECIAL_CASE];
	const duplicates = constants.filter((item, index) => constants.indexOf(item) !== index);

	expect(duplicates).toEqual([]);
});
