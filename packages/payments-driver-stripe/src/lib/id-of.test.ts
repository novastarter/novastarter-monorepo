/**
 * Tests of the Stripe reference helper: the id of a reference whether Stripe sent the id or the expanded object.
 */
import { describe, expect, test } from 'vitest';
import { idOf } from './id-of.js';

describe('idOf', () => {
	test('Reads a string reference as is and an expanded one by its id', () => {
		expect(idOf('cus_1')).toBe('cus_1');

		expect(idOf({ id: 'cus_1' })).toBe('cus_1');
	});

	test('Answers null for no reference', () => {
		// Stripe sends `null` for an unset reference and an absent field reads as `undefined`; both become `null`, so
		// callers can store the value in a nullable column without a second check.
		expect(idOf(null)).toBeNull();
		expect(idOf(undefined)).toBeNull();
	});
});
