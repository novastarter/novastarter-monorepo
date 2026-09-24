/**
 * Tests of `utils/format-title/constants/special-case`: the invariants the lookup in `handleSpecialWords` relies on.
 */
import { expect, test } from 'vitest';
import { SPECIAL_CASE } from './special-case.js';

test('No two entries are the same word in a different casing', () => {
	// The lookup is case-insensitive and answers with the first entry that matches, so a second spelling of the
	// same word could never be reached
	const lowerCased = SPECIAL_CASE.map((entry) => entry.toLowerCase());
	const duplicates = lowerCased.filter((item, index) => lowerCased.indexOf(item) !== index);

	expect(duplicates).toEqual([]);
});

test('Holds the mixed-case spellings the acronym list cannot', () => {
	// `FAQs`, `IDs` and `PDFs` are plural acronyms; upper-casing them would give `FAQS`, so they belong here
	expect(SPECIAL_CASE).toEqual(expect.arrayContaining(['FAQs', 'IDs', 'PDFs']));
});
