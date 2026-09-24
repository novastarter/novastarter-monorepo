/**
 * Tests of `auth/tokens/check-token`.
 *
 * The limiter is the real local one of `@novastarter/memory`; storage is a map the `spend` callback deletes from.
 */
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import type { TokenRecord } from '../types.js';
import { checkToken } from './check-token.js';
import { createToken } from './create-token.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * The error every refused token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * Storage the way an application keeps it: records by id, with an atomic take-out.
 *
 * @returns The map and the `spend` callback that deletes from it.
 */
const storage = (): {
	records: Map<string, TokenRecord>;
	spend: (id: string, purpose: string) => Promise<TokenRecord | null>;
} => {
	const records = new Map<string, TokenRecord>();

	// The same match as `DELETE … WHERE id = $id AND purpose = $purpose RETURNING *`: gone once taken
	const spend = async (id: string, purpose: string): Promise<TokenRecord | null> => {
		const record = records.get(id);

		if (!record || record.purpose !== purpose) {
			return null;
		}

		records.delete(id);

		return record;
	};

	return { records, spend };
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
	test('Returns the record of a current link token, once', async () => {
		const { records, spend } = storage();
		const { token, record } = createToken({ purpose: 'password-reset', userId: 'user-1', data: { next: '/' } });

		records.set(record.id, record);

		await expect(checkToken({ purpose: 'password-reset', token, spend })).resolves.toBe(record);

		await expect(checkToken({ purpose: 'password-reset', token, spend })).rejects.toMatchObject(INVALID);
	});

	test('Looks a code up by the user and the code together', async () => {
		const { records, spend } = storage();
		const { token, record } = createToken({ purpose: 'sign-in', userId: 'user-1', format: 'code' });

		records.set(record.id, record);

		await expect(checkToken({ purpose: 'sign-in', token, spend })).rejects.toMatchObject(INVALID);
		await expect(checkToken({ purpose: 'sign-in', token, userId: 'user-2', spend })).rejects.toMatchObject(INVALID);
		await expect(checkToken({ purpose: 'sign-in', token, userId: 'user-1', spend })).resolves.toBe(record);
	});

	test('Refuses a missing record, another purpose and an expired one alike', async () => {
		const { records, spend } = storage();

		await expect(checkToken({ purpose: 'password-reset', token: 'nope', spend })).rejects.toMatchObject(INVALID);

		const other = createToken({ purpose: 'email-confirm' });

		await expect(
			checkToken({ purpose: 'password-reset', token: other.token, spend: async () => other.record }),
		).rejects.toMatchObject(INVALID);

		const expiring = createToken({ purpose: 'password-reset', ttl: 60_000 });

		records.set(expiring.record.id, expiring.record);
		vi.setSystemTime(NOW + 60_000);

		await expect(checkToken({ purpose: 'password-reset', token: expiring.token, spend })).rejects.toMatchObject(
			INVALID,
		);
	});

	test('Charges the code limiter per purpose and user on every miss, and resets it on a hit', async () => {
		const { records, spend } = storage();
		const code = new LimiterDriverLocal({ points: 2, duration: 60 });
		const consume = vi.spyOn(code, 'consume');
		const reset = vi.spyOn(code, 'delete');

		useAuth().registerSettings({ limiters: { code } });

		const attempt = (token: string, userId = 'user-1', purpose = 'sign-in'): Promise<TokenRecord> => {
			return checkToken({ purpose, token, userId, spend });
		};

		await expect(attempt('wrong')).rejects.toMatchObject(INVALID);
		expect(consume).toHaveBeenLastCalledWith('sign-in:user-1');

		const first = createToken({ purpose: 'sign-in', userId: 'user-1', format: 'code' });

		records.set(first.record.id, first.record);
		await expect(attempt(first.token)).resolves.toBe(first.record);
		expect(reset).toHaveBeenCalledWith('sign-in:user-1');

		const second = createToken({ purpose: 'sign-in', userId: 'user-1', format: 'code' });

		records.set(second.record.id, second.record);
		await expect(attempt('wrong')).rejects.toMatchObject(INVALID);
		await expect(attempt('wrong')).rejects.toMatchObject(INVALID);
		await expect(attempt(second.token)).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });

		await expect(attempt('wrong', 'user-2')).rejects.toMatchObject(INVALID);
		await expect(attempt('wrong', 'user-1', 'email-confirm')).rejects.toMatchObject(INVALID);
	});

	test('Does not charge the limiter for a link token', async () => {
		const { spend } = storage();
		const code = new LimiterDriverLocal({ points: 1, duration: 60 });
		const consume = vi.spyOn(code, 'consume');

		useAuth().registerSettings({ limiters: { code } });

		// No user given means a link: 256 bits need no limiter
		await expect(checkToken({ purpose: 'password-reset', token: 'a', spend })).rejects.toMatchObject(INVALID);
		await expect(checkToken({ purpose: 'password-reset', token: 'b', spend })).rejects.toMatchObject(INVALID);

		expect(consume).not.toHaveBeenCalled();
	});
});
