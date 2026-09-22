/**
 * Tests of `auth/mfa/recovery-codes`.
 *
 * The limiter is the real local one of `@novastarter/memory`.
 */
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { generateRecoveryCodes, RECOVERY_CODE_COUNT, recoveryCodeId, verifyRecoveryCode } from './recovery-codes.js';

afterEach(() => {
	useAuth.reset();
});

describe('generateRecoveryCodes', () => {
	test('Makes ten distinct codes of two groups of five, with their ids', () => {
		const { codes, ids } = generateRecoveryCodes();

		// 1. Ten codes in the readable `xxxxx-xxxxx` form, none repeated
		expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
		expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

		for (const code of codes) {
			expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
		}

		// 2. The ids line up with the codes, so the application stores them in their place
		expect(ids).toStrictEqual(codes.map(recoveryCodeId));
	});

	test('Makes a new set on every call', () => {
		// 1. A regenerated set shares nothing with the old one
		const first = generateRecoveryCodes().codes;
		const second = generateRecoveryCodes().codes;

		expect(first.filter((code) => second.includes(code))).toStrictEqual([]);
	});
});

describe('recoveryCodeId', () => {
	test('Ignores dashes, spaces and case', () => {
		// 1. However the user types the code, it finds the same record
		const id = recoveryCodeId('abcde-fghij');

		expect(recoveryCodeId('abcdefghij')).toBe(id);
		expect(recoveryCodeId('ABCDE-FGHIJ')).toBe(id);
		expect(recoveryCodeId(' abcde fghij ')).toBe(id);

		// 2. Another code is another id
		expect(recoveryCodeId('abcde-fghik')).not.toBe(id);
	});
});

describe('verifyRecoveryCode', () => {
	test('Spends the code by its id and resolves when there was one', async () => {
		const spend = vi.fn(async () => true);

		// 1. The typed form is normalised before the lookup
		await expect(verifyRecoveryCode({ userId: 'user-1', code: 'ABCDE FGHIJ', spend })).resolves.toBeUndefined();

		expect(spend).toHaveBeenCalledWith(recoveryCodeId('abcde-fghij'));
	});

	test('Refuses a code the user does not have', async () => {
		// 1. Nothing spent means a wrong code, or one used already
		await expect(
			verifyRecoveryCode({ userId: 'user-1', code: 'abcde-fghij', spend: async () => false }),
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
	});

	test('Charges the mfa limiter per user on every attempt and clears it on success', async () => {
		const mfa = new LimiterDriverLocal({ points: 2, duration: 60 });

		useAuth().registerSettings({ limiters: { mfa } });

		/**
		 * Try a code for `user-1`, the spender answering as told.
		 *
		 * @param found - Whether the code exists.
		 * @returns Once the code is spent.
		 */
		const attempt = (found: boolean): Promise<void> => {
			// 1. Same user every time, so every attempt draws on one budget
			return verifyRecoveryCode({ userId: 'user-1', code: 'abcde-fghij', spend: async () => found });
		};

		// 1. A miss, then a right code, which clears the count
		await expect(attempt(false)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(true)).resolves.toBeUndefined();

		// 2. The full budget of two misses is there again, then the limiter refuses even a right code
		await expect(attempt(false)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(false)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(true)).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });

		// 3. Another user has a budget of its own
		await expect(
			verifyRecoveryCode({ userId: 'user-2', code: 'abcde-fghij', spend: async () => true }),
		).resolves.toBeUndefined();
	});
});
