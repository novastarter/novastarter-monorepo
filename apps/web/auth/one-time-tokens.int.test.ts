/**
 * Integration tests of `auth/one-time-tokens` on PGlite in memory, migrated with the app's `drizzle/` folder. No
 * service is needed, so the suite always runs.
 */
import { oneTimeTokenId } from '@novastarter/auth';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { useDb } from '../db';
import { authTokens } from '../db/schema';
import { issueToken, revokeTokens, spendToken } from './one-time-tokens';
import { bootTestDatabase, clearAuthTables, closeTestDatabase } from './test-database';

/**
 * The error every refusal of a token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

describe('auth one-time tokens on PGlite', { timeout: 30_000 }, () => {
	beforeAll(bootTestDatabase, 60_000);

	afterAll(closeTestDatabase);

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Issues a link token stored by its hash and spends it once', async () => {
		const { token, record } = await issueToken({
			purpose: 'password-reset',
			userId: '1',
			data: { next: '/settings' },
		});

		// 1. The table keeps the hash, never the token
		const [row] = await useDb().select().from(authTokens);

		expect(row?.id).toBe(oneTimeTokenId(token));
		expect(row?.id).not.toBe(token);

		// 2. Spent once, with its user and data
		expect(await spendToken('password-reset', token)).toEqual(record);
		expect(record).toMatchObject({ userId: '1', data: { next: '/settings' } });

		// 3. A second time it is gone
		await expect(spendToken('password-reset', token)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a token of another purpose and leaves it for its own', async () => {
		const { token } = await issueToken({ purpose: 'email-confirm' });

		// 1. The purpose is part of the key, so the wrong one matches nothing
		await expect(spendToken('password-reset', token)).rejects.toMatchObject(INVALID);

		// 2. The right one still works
		await expect(spendToken('email-confirm', token)).resolves.toMatchObject({ purpose: 'email-confirm' });
	});

	test('Refuses an expired token and deletes it all the same', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 0, 1) });

		const { token, record } = await issueToken({ purpose: 'sign-in', ttl: 1_000 });

		vi.setSystemTime(record.expiresAt);

		// 1. Past its deadline it is refused, and the attempt spent it
		await expect(spendToken('sign-in', token)).rejects.toMatchObject(INVALID);
		expect(await useDb().select().from(authTokens)).toHaveLength(0);
	});

	test('Keeps one code per user and purpose, looked up with its user', async () => {
		const first = await issueToken({ purpose: 'sign-in', userId: '1', format: 'code' });
		const other = await issueToken({ purpose: 'email-confirm', userId: '1', format: 'code' });
		const second = await issueToken({ purpose: 'sign-in', userId: '1', format: 'code' });

		// 1. The new code voided the earlier one of the purpose; the other purpose's code stays
		expect(second.token).toMatch(/^\d{6}$/);
		await expect(spendToken('sign-in', first.token, { userId: '1' })).rejects.toMatchObject(INVALID);

		// 2. A code is found only together with its user
		await expect(spendToken('sign-in', second.token, { userId: '2' })).rejects.toMatchObject(INVALID);
		await expect(spendToken('sign-in', second.token, { userId: '1' })).resolves.toMatchObject({ userId: '1' });
		await expect(spendToken('email-confirm', other.token, { userId: '1' })).resolves.toMatchObject({ userId: '1' });
	});

	test('Refuses a code without a user before deleting anything', async () => {
		const { token } = await issueToken({ purpose: 'sign-in', userId: '1', format: 'code' });

		// 1. The package refuses the request, and the existing code survives
		await expect(issueToken({ purpose: 'sign-in', format: 'code' })).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
		});

		await expect(spendToken('sign-in', token, { userId: '1' })).resolves.toMatchObject({ userId: '1' });
	});

	test('Lets exactly one of two concurrent spends win', async () => {
		const { token } = await issueToken({ purpose: 'password-reset', userId: '1' });

		// 1. The atomic delete hands the row to one request only
		const outcomes = await Promise.allSettled([
			spendToken('password-reset', token),
			spendToken('password-reset', token),
		]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
	});

	test('Revokes the tokens of a user, of one purpose or all', async () => {
		const reset = await issueToken({ purpose: 'password-reset', userId: '1' });
		const confirm = await issueToken({ purpose: 'email-confirm', userId: '1' });
		const stranger = await issueToken({ purpose: 'password-reset', userId: '2' });

		// 1. One purpose
		expect(await revokeTokens('1', 'password-reset')).toBe(1);
		await expect(spendToken('password-reset', reset.token)).rejects.toMatchObject(INVALID);

		// 2. Everything left of the user, the other user's untouched
		await issueToken({ purpose: 'sign-in', userId: '1' });
		expect(await revokeTokens('1')).toBe(2);
		await expect(spendToken('email-confirm', confirm.token)).rejects.toMatchObject(INVALID);
		await expect(spendToken('password-reset', stranger.token)).resolves.toMatchObject({ userId: '2' });
	});
});
