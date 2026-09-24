/**
 * Tests of `collapse-id`: the one collapse-tag sanitising every push driver shares.
 */
import { describe, expect, test } from 'vitest';
import { COLLAPSE_ID_MAX_LENGTH, toCollapseId } from './collapse-id.js';

describe('toCollapseId', () => {
	test('Keeps the safe alphabet, replaces the rest and cuts to the limit', () => {
		// Anything outside letters, digits and `_ . : -` would make the HTTP client refuse the header
		expect(toCollapseId('invoice.paid:42')).toBe('invoice.paid:42');
		expect(toCollapseId('счёт-42')).toBe('____-42');
		expect(toCollapseId('a b/c')).toBe('a_b_c');

		// An emoji is one code point, so one `_`, not one per surrogate half
		expect(toCollapseId('a😀b')).toBe('a_b');

		// The limit is bytes: the cut happens after the replacement, where a character is a byte
		expect(toCollapseId('ё'.repeat(40))).toBe('_'.repeat(40));
		expect(toCollapseId('x'.repeat(100))).toBe('x'.repeat(COLLAPSE_ID_MAX_LENGTH));
		expect(Buffer.byteLength(toCollapseId('ё'.repeat(100)) as string)).toBe(COLLAPSE_ID_MAX_LENGTH);
		expect(Buffer.byteLength(toCollapseId('😀'.repeat(100)) as string)).toBe(COLLAPSE_ID_MAX_LENGTH);

		expect(toCollapseId('')).toBeUndefined();
		expect(toCollapseId(undefined)).toBeUndefined();
	});
});
