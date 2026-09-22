/**
 * Tests of `pick-email`: which address of `GET /user/emails` the identity carries.
 */
import { describe, expect, test } from 'vitest';
import { pickEmail } from './pick-email.js';

describe('pickEmail', () => {
	test('Picks the primary address when it is verified', () => {
		expect(
			pickEmail([
				{ email: 'old@example.com', primary: false, verified: true, visibility: null },
				{ email: 'ada@example.com', primary: true, verified: true, visibility: 'private' },
			]),
		).toBe('ada@example.com');
	});

	test('Picks nothing when the primary address is unverified, even with another verified one', () => {
		// 1. A verified secondary is not the person's chosen address; an unverified primary must not link accounts
		expect(
			pickEmail([
				{ email: 'ada@example.com', primary: true, verified: false },
				{ email: 'old@example.com', primary: false, verified: true },
			]),
		).toBeUndefined();
	});

	test('Picks nothing from a body that is not a list or from entries of the wrong shape', () => {
		// 1. The list comes from the network: truthy strings do not pass for booleans, and junk entries are skipped
		expect(pickEmail(undefined)).toBeUndefined();
		expect(pickEmail({ message: 'Not Found' })).toBeUndefined();
		expect(pickEmail([null, 'x', { email: 'a@b.c', primary: 'true', verified: 'true' }])).toBeUndefined();
		expect(pickEmail([{ email: '', primary: true, verified: true }])).toBeUndefined();
	});
});
