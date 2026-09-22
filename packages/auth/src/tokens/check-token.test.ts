/**
 * Tests of `auth/tokens/check-token`.
 *
 * The limiter is the real local one of `@novastarter/memory`.
 */
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import type { TokenRecord } from '../types.js';
import { checkToken } from './check-token.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * The error every refused token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * Build a token record of a purpose, valid for a minute.
 *
 * @param purpose - What the token was made for.
 * @returns The record.
 */
const record = (purpose: string): TokenRecord => {
	// 1. The id does not matter to the check: the application already found the record by it
	return { id: 'id', purpose, userId: 'user-1', createdAt: NOW, expiresAt: NOW + 60_000, data: { next: '/' } };
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('checkToken', () => {
	test('Returns a current record of the purpose', async () => {
		const found = record('password-reset');

		// 1. The very record, with its user and data
		await expect(checkToken('password-reset', found)).resolves.toBe(found);
	});

	test('Refuses a missing record, another purpose and an expired one alike', async () => {
		// 1. Nothing came back from the delete
		await expect(checkToken('password-reset', undefined)).rejects.toMatchObject(INVALID);
		await expect(checkToken('password-reset', null)).rejects.toMatchObject(INVALID);

		// 2. A token for another purpose cannot stand in
		await expect(checkToken('password-reset', record('email-confirm'))).rejects.toMatchObject(INVALID);

		// 3. At its deadline the token is dead
		vi.setSystemTime(NOW + 60_000);
		await expect(checkToken('password-reset', record('password-reset'))).rejects.toMatchObject(INVALID);
	});

	test('Charges the code limiter per purpose and user on every attempt, misses included', async () => {
		const code = new LimiterDriverLocal({ points: 2, duration: 60 });
		const consume = vi.spyOn(code, 'consume');

		useAuth().registerSettings({ limiters: { code } });

		// 1. A miss and a hit both cost a point, under the purpose and the user
		await expect(checkToken('sign-in', undefined, { userId: 'user-1' })).rejects.toMatchObject(INVALID);
		await expect(checkToken('sign-in', record('sign-in'), { userId: 'user-1' })).resolves.toBeDefined();

		expect(consume).toHaveBeenNthCalledWith(1, 'sign-in:user-1');
		expect(consume).toHaveBeenNthCalledWith(2, 'sign-in:user-1');

		// 2. The budget is spent: even a right code is refused now
		await expect(checkToken('sign-in', record('sign-in'), { userId: 'user-1' })).rejects.toMatchObject({
			code: 'REQUESTS_EXCEEDED',
		});

		// 3. Another user and another purpose have budgets of their own
		await expect(checkToken('sign-in', record('sign-in'), { userId: 'user-2' })).resolves.toBeDefined();
		await expect(checkToken('email-confirm', record('email-confirm'), { userId: 'user-1' })).resolves.toBeDefined();
	});

	test('Does not charge the limiter for a link token', async () => {
		const code = new LimiterDriverLocal({ points: 1, duration: 60 });
		const consume = vi.spyOn(code, 'consume');

		useAuth().registerSettings({ limiters: { code } });

		// 1. No user given means a link: 256 bits need no limiter
		await checkToken('password-reset', record('password-reset'));
		await checkToken('password-reset', record('password-reset'));

		expect(consume).not.toHaveBeenCalled();
	});
});
