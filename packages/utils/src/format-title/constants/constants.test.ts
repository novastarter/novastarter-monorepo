/**
 * Tests of `utils/format-title/constants/constants`.
 */
import { expect, test } from 'vitest';
import acronyms from '../constants/acronyms.js';
import specialCase from '../constants/special-case.js';

test('No duplicates across acronyms and special cases', () => {
	// 1. The special-case check runs before the acronym check, so a word in both lists would silently shadow the
	//    acronym; keeping the lists disjoint makes the precedence irrelevant
	const constants = [...acronyms, ...specialCase];
	const duplicates = constants.filter((item, index) => constants.indexOf(item) !== index);

	expect(duplicates).toEqual([]);
});
