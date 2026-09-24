/**
 * Tests of `auth/tokens/create-token`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_CODE_TTL, DEFAULT_TOKEN_TTL } from '../lib/settings.js';
import { useAuth } from '../lib/use-auth.js';
import { CODE_DIGITS, createToken } from './create-token.js';
import { oneTimeTokenId } from './one-time-token-id.js';

/**
 * The frozen clock every test runs at.
 */
const NOW = Date.UTC(2026, 0, 1);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('createToken', () => {
	test('Makes a link token by default, its record keyed by the token alone', () => {
		const { token, record } = createToken({ purpose: 'password-reset', userId: 'user-1' });

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

		expect(record).toStrictEqual({
			id: oneTimeTokenId(token),
			purpose: 'password-reset',
			userId: 'user-1',
			createdAt: NOW,
			expiresAt: NOW + DEFAULT_TOKEN_TTL,
		});
	});

	test('Makes a link token without a user and keeps the data', () => {
		const { record } = createToken({ purpose: 'email-confirm', data: { email: 'a@example.com' } });

		expect(record).not.toHaveProperty('userId');
		expect(record.data).toStrictEqual({ email: 'a@example.com' });
	});

	test('Makes a numeric code bound to its user, with the shorter default lifetime', () => {
		const { token, record } = createToken({ purpose: 'sign-in', userId: 'user-1', format: 'code' });

		expect(token).toMatch(new RegExp(`^\\d{${CODE_DIGITS}}$`));
		expect(record.id).toBe(oneTimeTokenId(token, 'user-1'));
		expect(record.id).not.toBe(oneTimeTokenId(token));
		expect(record.expiresAt).toBe(NOW + DEFAULT_CODE_TTL);
	});

	test('Takes the lifetimes from the settings, and a per-call one over them', () => {
		useAuth().registerSettings({ tokens: { ttl: 5_000, codeTtl: 1_000 } });

		expect(createToken({ purpose: 'p' }).record.expiresAt).toBe(NOW + 5_000);
		expect(createToken({ purpose: 'p', userId: 'u', format: 'code' }).record.expiresAt).toBe(NOW + 1_000);

		expect(createToken({ purpose: 'p', ttl: 42 }).record.expiresAt).toBe(NOW + 42);
		expect(createToken({ purpose: 'p', userId: 'u', format: 'code', ttl: 42 }).record.expiresAt).toBe(NOW + 42);
	});

	test('Refuses an empty purpose and a code without a user', () => {
		expect(() => createToken({ purpose: '' })).toThrow(expect.objectContaining({ code: 'INVALID_PAYLOAD' }));

		expect(() => createToken({ purpose: 'sign-in', format: 'code' })).toThrow(
			expect.objectContaining({ code: 'INVALID_PAYLOAD' }),
		);
	});
});
