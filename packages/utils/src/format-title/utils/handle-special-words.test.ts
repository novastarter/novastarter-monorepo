/**
 * Tests of `utils/format-title/utils/handle-special-words`.
 */
import { expect, test } from 'vitest';
import { handleSpecialWords } from './handle-special-words.js';

test('Returns special formatting when matches', () => {
	// The special-case list is matched case-insensitively and wins over every other rule, position included
	expect(handleSpecialWords('mysql', 0, ['mysql'])).toBe('MySQL');
});

test(`Returns string uppercased when it's an acronym`, () => {
	// An acronym is matched on its upper-cased form and answered with in that form, whatever the input casing
	expect(handleSpecialWords('json', 0, ['json'])).toBe('JSON');
});

test(`If string is first, and not special or an acronym, return as is`, () => {
	// The first word keeps the capital it arrived with; the minor-word rules never apply to it
	expect(handleSpecialWords('Hello', 0, ['Hello'])).toBe('Hello');
});

test(`If string is last, and not special or an acronym, return as is`, () => {
	// The last word keeps its capital too, so `words` is what tells the function which word is last
	expect(handleSpecialWords('World', 1, ['Hello', 'World'])).toBe('World');
});

test(`If string is four characters or more, return as is`, () => {
	// `whether` is a conjunction, so only the length rule keeps it capitalized here
	expect(handleSpecialWords('Whether', 1, ['a', 'Whether', 'c'])).toBe('Whether');
});

test(`Return lowercased if preposition`, () => {
	// A short preposition in the middle of the sentence is lower-cased
	expect(handleSpecialWords('To', 1, ['a', 'To', 'c'])).toBe('to');
});

test(`Return lowercased if conjunction`, () => {
	// A short conjunction in the middle of the sentence is lower-cased
	expect(handleSpecialWords('If', 1, ['a', 'If', 'c'])).toBe('if');
});

test(`Return lowercased if article`, () => {
	// A short article in the middle of the sentence is lower-cased
	expect(handleSpecialWords('The', 1, ['a', 'The', 'c'])).toBe('the');
});

test(`Return string as is otherwise`, () => {
	// A word in no list keeps the capital it arrived with, whatever its position
	expect(handleSpecialWords('Testing', 1, ['a', 'Testing', 'c'])).toBe('Testing');
});
