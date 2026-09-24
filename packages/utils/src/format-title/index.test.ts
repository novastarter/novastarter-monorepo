/**
 * Tests of `utils/format-title/index`.
 */
import { expect, test } from 'vitest';
import { formatTitle } from './index.js';

/**
 * End-to-end cases covering camelCase, PascalCase, snake_case, kebab-case, a minor word and a special-case brand.
 */
const tests: [string, string][] = [
	['snowWhiteAndTheSevenDwarfs', 'Snow White and the Seven Dwarfs'],
	['NewcastleUponTyne', 'Newcastle Upon Tyne'],
	['brighton_on_sea', 'Brighton on Sea'],
	['apple_releases_new_ipad', 'Apple Releases New iPad'],
	['7-food-trends', '7 Food Trends'],
];

for (const [input, output] of tests) {
	test(`${input} => ${output}`, () => {
		// Each row is one documented example of the readme; the table there and this list must agree
		expect(formatTitle(input)).toBe(output);
	});
}

test('Joins with single spaces whatever the separators around and between the words', () => {
	// Doubled, leading and trailing separators used to leave empty words behind, each joined with a space of its own
	expect(formatTitle('hello--world')).toBe('Hello World');
	expect(formatTitle('hello world ')).toBe('Hello World');
	expect(formatTitle(' a')).toBe('A');
	expect(formatTitle('__snake__case__')).toBe('Snake Case');

	// An empty word used to count as the last word, so the minor word before it stayed lower-cased
	expect(formatTitle('come in ')).toBe('Come In');

	// Nothing but separators, or nothing at all, is an empty title, not a string of spaces
	expect(formatTitle('')).toBe('');
	expect(formatTitle('---')).toBe('');
});

test('Keeps an acronym spelled with a digit whole and splits a capital run before a word, not before a digit', () => {
	// `MP3` used to be broken into `M P3` and `M2M`, a listed acronym, into `M2 M`; `MP3` and `HTML5` are not listed,
	// so they are capitalized like any other word
	expect(formatTitle('MP3Player')).toBe('Mp3 Player');
	expect(formatTitle('HTML5Parser')).toBe('Html5 Parser');
	expect(formatTitle('M2M')).toBe('M2M');
	expect(formatTitle('W3CStandards')).toBe('W3C Standards');
});

test('Spells a mixed-case special word as listed', () => {
	// `FAQs` sat in the acronym list, where the upper-cased comparison could never match it
	expect(formatTitle('read_the_faqs')).toBe('Read the FAQs');
	expect(formatTitle('faqs')).toBe('FAQs');
});
