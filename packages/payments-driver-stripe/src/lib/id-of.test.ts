/**
 * Tests of the Stripe reference helper: the id of a reference whether Stripe sent the id or the expanded object.
 */
import { describe, expect, test } from 'vitest';
import { idOf } from './id-of.js';

describe('idOf', () => {
	test('Reads a string reference as is and an expanded one by its id', () => {
		// 1. Without `expand`, Stripe sends the id itself
		expect(idOf('cus_1')).toBe('cus_1');

		// 2. With `expand`, the whole object arrives; only its id matters to the kit
		expect(idOf({ id: 'cus_1' })).toBe('cus_1');
	});

	test('Answers null for no reference', () => {
		// 1. Stripe sends `null` for an unset reference; an absent field reads as `undefined` — both are `null`, so
		//    callers can store the value in a nullable column without a second check
		expect(idOf(null)).toBeNull();
		expect(idOf(undefined)).toBeNull();
	});
});
