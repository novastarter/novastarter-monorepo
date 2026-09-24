/**
 * Tests of `utils/format-title/utils/decamelize`.
 */
import { expect, test } from 'vitest';
import { decamelize } from './decamelize.js';

test('Converts camelcase to underscores', () => {
	// The plain case: one boundary between a lower-case letter and a capital
	expect(decamelize('camelCase')).toBe('camel_case');
	expect(decamelize('snowWhiteAndTheSevenDwarfs')).toBe('snow_white_and_the_seven_dwarfs');
});

test('Keeps a run of capitals together and splits it from the word that follows', () => {
	// `XML` is one word, `Parser` the next; letter by letter would give `x_m_l_parser`
	expect(decamelize('XMLParser')).toBe('xml_parser');
	expect(decamelize('getHTMLElement')).toBe('get_html_element');
});

test('Keeps a run of capitals together when digits follow it', () => {
	// A digit is not the start of a word: `MP3` used to be split before its last capital into `m_p3`
	expect(decamelize('MP3Player')).toBe('mp3_player');
	expect(decamelize('HTML5Parser')).toBe('html5_parser');
	expect(decamelize('ISO8601Date')).toBe('iso8601_date');
});

test('Keeps an acronym spelled with a digit as one word', () => {
	// The capital after the digit starts no lower-case word, so there is no boundary; the acronym list holds these
	expect(decamelize('M2M')).toBe('m2m');
	expect(decamelize('W3C')).toBe('w3c');
	expect(decamelize('2FA')).toBe('2fa');
	expect(decamelize('M2MMapping')).toBe('m2m_mapping');
});

test('Leaves snake_case and plain text alone', () => {
	// Nothing to mark: no capital follows a lower-case letter and there is no run of capitals
	expect(decamelize('already_snake')).toBe('already_snake');
	expect(decamelize('7-food-trends')).toBe('7-food-trends');
});
