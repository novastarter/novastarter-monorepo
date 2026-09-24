/**
 * Tests of `auth/sessions/create-session`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SESSION_TTL } from '../lib/settings.js';
import { useAuth } from '../lib/use-auth.js';
import { hashToken } from '../utils/index.js';
import { createSession } from './create-session.js';

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

describe('createSession', () => {
	test('Returns a random token and a record keyed by its hash, with the default lifetime', () => {
		const { token, session } = createSession('user-1');

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(session.id).toBe(hashToken(token));
		expect(session.id).not.toBe(token);

		expect(session).toStrictEqual({
			id: hashToken(token),
			userId: 'user-1',
			createdAt: NOW,
			expiresAt: NOW + DEFAULT_SESSION_TTL,
			absoluteExpiresAt: NOW + DEFAULT_SESSION_TTL,
		});
	});

	test('Makes a new token on every call', () => {
		expect(createSession('user-1').token).not.toBe(createSession('user-1').token);
	});

	test('Uses the lifetimes of the settings, the idle deadline capped by the hard one', () => {
		useAuth().registerSettings({ session: { ttl: 60_000, idleTtl: 10_000 } });

		expect(createSession('user-1').session).toMatchObject({ expiresAt: NOW + 10_000, absoluteExpiresAt: NOW + 60_000 });

		useAuth().registerSettings({ session: { ttl: 60_000, idleTtl: 120_000 } });

		expect(createSession('user-1').session).toMatchObject({ expiresAt: NOW + 60_000, absoluteExpiresAt: NOW + 60_000 });
	});

	test('Keeps the metadata with the record', () => {
		const { session } = createSession('user-1', { metadata: { userAgent: 'test' } });

		expect(session.metadata).toStrictEqual({ userAgent: 'test' });
	});
});
