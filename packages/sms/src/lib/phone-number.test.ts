/**
 * Tests of `sms/lib/phone-number`: the E.164 check `sendSms()` refuses on and the clean-up that runs before it.
 */
import { describe, expect, test } from 'vitest';
import { isPhoneNumber, normalizePhoneNumber } from './phone-number.js';

describe('isPhoneNumber', () => {
	test('Accepts E.164 only', () => {
		// 1. A `+`, a country code that does not start with 0, up to 15 digits in all
		expect(isPhoneNumber('+14155550123')).toBe(true);
		expect(isPhoneNumber('+447700900123')).toBe(true);
		expect(isPhoneNumber('+79')).toBe(true);

		// 2. Anything else — no plus, separators, a leading zero, too long — is refused
		expect(isPhoneNumber('14155550123')).toBe(false);
		expect(isPhoneNumber('+1 415 555 0123')).toBe(false);
		expect(isPhoneNumber('+04155550123')).toBe(false);
		expect(isPhoneNumber('+1234567890123456')).toBe(false);
		expect(isPhoneNumber('+')).toBe(false);
		expect(isPhoneNumber('')).toBe(false);
	});
});

describe('normalizePhoneNumber', () => {
	test('Drops separators and turns the 00 prefix into a plus', () => {
		// 1. Spaces, dashes, dots and parentheses are how people write numbers; none of them reach a provider
		expect(normalizePhoneNumber(' +1 (415) 555-0123 ')).toBe('+14155550123');
		expect(normalizePhoneNumber('+44.7700.900123')).toBe('+447700900123');

		// 2. The international `00` prefix means the same as `+`
		expect(normalizePhoneNumber('0044 7700 900123')).toBe('+447700900123');
	});

	test('Leaves a bare digit string alone rather than guessing its country', () => {
		// 1. `4155550123` could be a US number or a national one of any country; adding `+` would be a guess
		expect(normalizePhoneNumber('415 555 0123')).toBe('4155550123');

		// 2. A number already in E.164 is handed back unchanged
		expect(normalizePhoneNumber('+14155550123')).toBe('+14155550123');
	});
});
