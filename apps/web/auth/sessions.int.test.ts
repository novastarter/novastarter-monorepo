/**
 * Integration tests of `auth/sessions` on PGlite in memory, migrated with the app's `drizzle/` folder. No service is
 * needed, so the suite always runs.
 */
import { hashToken, useAuth } from '@novastarter/auth';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDb } from '../db';
import { authSessions } from '../db/schema';
import { endAllSessions, endSession, endSessionById, listSessions, readSession, startSession } from './sessions';
import { bootTestDatabase, clearAuthTables, closeTestDatabase, TEST_SECRET } from './test-database';

/**
 * The frozen clock the tests start at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * One minute, in milliseconds.
 */
const MINUTE = 60_000;

describe('auth sessions on PGlite', { timeout: 30_000 }, () => {
	beforeAll(bootTestDatabase, 60_000);

	afterAll(closeTestDatabase);

	beforeEach(() => {
		// 1. Only `Date` is faked: PGlite keeps its real timers
		vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	});

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Starts a session keyed by the token hash and reads it back with its metadata', async () => {
		const { token, session } = await startSession('1', { userAgent: 'test' });

		// 1. The token itself is nowhere in the table
		const [row] = await useDb().select().from(authSessions);

		expect(row?.id).toBe(hashToken(token));
		expect(row?.id).not.toBe(token);
		expect(row?.createdAt).toEqual(new Date(NOW));

		// 2. Read back as the record the package made, epoch milliseconds and all
		expect(await readSession(token)).toEqual(session);
		expect(session.metadata).toEqual({ userAgent: 'test' });
	});

	test('Returns null for an unknown token and deletes an expired session', async () => {
		expect(await readSession('unknown')).toBeNull();

		// 1. Past its deadline the session is no session, and its row goes on sight
		const { token, session } = await startSession('1');

		vi.setSystemTime(session.expiresAt);

		expect(await readSession(token)).toBeNull();
		expect(await useDb().select().from(authSessions)).toHaveLength(0);
	});

	test('Slides the idle deadline once half of the idle lifetime passed, and stores it', async () => {
		useAuth().registerSettings({ jwt: { secret: TEST_SECRET }, session: { idleTtl: 30 * MINUTE } });

		const { token, session } = await startSession('1');

		// 1. Early on nothing moves
		vi.setSystemTime(NOW + 5 * MINUTE);
		expect((await readSession(token))?.expiresAt).toBe(session.expiresAt);

		// 2. Past half the idle lifetime the deadline moves forward, and the row carries the new one
		vi.setSystemTime(NOW + 20 * MINUTE);
		expect((await readSession(token))?.expiresAt).toBe(NOW + 50 * MINUTE);

		const [row] = await useDb().select().from(authSessions).where(eq(authSessions.id, session.id));

		expect(row?.expiresAt).toEqual(new Date(NOW + 50 * MINUTE));
	});

	test('Ends one session by token', async () => {
		const { token } = await startSession('1');
		const other = await startSession('1');

		await endSession(token);

		// 1. Only the one named goes
		expect(await readSession(token)).toBeNull();
		expect(await readSession(other.token)).not.toBeNull();
	});

	test('Ends a session by id only for its owner', async () => {
		const { token, session } = await startSession('1');

		// 1. Another user cannot end it with its id
		expect(await endSessionById('2', session.id)).toBe(false);
		expect(await readSession(token)).not.toBeNull();

		// 2. The owner can
		expect(await endSessionById('1', session.id)).toBe(true);
		expect(await readSession(token)).toBeNull();
	});

	test('Ends every session of a user and leaves the others', async () => {
		await startSession('1');
		await startSession('1');

		const stranger = await startSession('2');

		// 1. Both of the user's sessions go
		expect(await endAllSessions('1')).toBe(2);
		expect(await listSessions('1')).toEqual([]);

		// 2. Another user stays signed in
		expect(await readSession(stranger.token)).not.toBeNull();
	});

	test('Lists live sessions, newest first', async () => {
		const first = await startSession('1');

		vi.setSystemTime(NOW + MINUTE);

		const second = await startSession('1');

		await startSession('2');

		// 1. Newest first, the other user's left out
		expect((await listSessions('1')).map((session) => session.id)).toEqual([second.session.id, first.session.id]);

		// 2. Past the first one's deadline only the second is live
		vi.setSystemTime(first.session.expiresAt);
		expect((await listSessions('1')).map((session) => session.id)).toEqual([second.session.id]);
	});
});
