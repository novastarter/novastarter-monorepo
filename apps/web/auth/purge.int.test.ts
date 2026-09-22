/**
 * Integration tests of `auth/purge` on PGlite in memory, migrated with the app's `drizzle/` folder. No service is
 * needed, so the suite always runs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { useDb } from '../db';
import { authRefreshTokens, authSessions, authTokens } from '../db/schema';
import { issueToken } from './one-time-tokens';
import { purgeExpiredAuthRows } from './purge';
import { issueTokens } from './refresh-tokens';
import { readSession, startSession } from './sessions';
import { bootTestDatabase, clearAuthTables, closeTestDatabase } from './test-database';

/**
 * The frozen clock the tests start at.
 */
const NOW = Date.UTC(2026, 0, 1);

describe('purgeExpiredAuthRows on PGlite', { timeout: 30_000 }, () => {
	beforeAll(bootTestDatabase, 60_000);

	afterAll(closeTestDatabase);

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Deletes expired sessions, tokens and refresh tokens and keeps the live ones', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: NOW });

		// 1. One of each that expires within the hour, and one of each that lasts longer
		await startSession('1');
		await issueToken({ purpose: 'sign-in', ttl: 60_000 });
		await issueToken({ purpose: 'password-reset', ttl: 2 * 60 * 60_000 });
		await issueTokens('1');

		// 2. An hour on, only the short token is past its deadline
		expect(await purgeExpiredAuthRows(NOW + 60 * 60_000)).toEqual({ sessions: 0, tokens: 1, refreshTokens: 0 });

		// 3. Far in the future everything is
		expect(await purgeExpiredAuthRows(NOW + 365 * 24 * 60 * 60_000)).toEqual({
			sessions: 1,
			tokens: 1,
			refreshTokens: 1,
		});

		const db = useDb();

		expect(await db.select().from(authSessions)).toHaveLength(0);
		expect(await db.select().from(authTokens)).toHaveLength(0);
		expect(await db.select().from(authRefreshTokens)).toHaveLength(0);
	});

	test('Uses the current time by default', async () => {
		const { token } = await startSession('1');

		// 1. A live session survives a purge now
		expect(await purgeExpiredAuthRows()).toEqual({ sessions: 0, tokens: 0, refreshTokens: 0 });
		expect(await readSession(token)).not.toBeNull();
	});
});
