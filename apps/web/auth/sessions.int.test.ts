/**
 * Integration tests of `auth/sessions` on PGlite in memory, migrated with the app's `drizzle/` folder, with the
 * in-process cache in front of it. No service is needed, so the suite always runs.
 */
import { hashToken, useAuth } from '@novastarter/auth';
import { useCache } from '@novastarter/memory';
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
		// Only `Date` is faked: PGlite keeps its real timers
		vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	});

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Starts a session keyed by the token hash and reads it back with its metadata', async () => {
		const { token, session } = await startSession('1', { userAgent: 'test' });

		// The token itself is nowhere in the table
		const [row] = await useDb().select().from(authSessions);

		expect(row?.id).toBe(hashToken(token));
		expect(row?.id).not.toBe(token);
		expect(row?.createdAt).toEqual(new Date(NOW));

		// Read back as the record the package made, epoch milliseconds and all
		expect(await readSession(token)).toEqual(session);
		expect(session.metadata).toEqual({ userAgent: 'test' });
	});

	test('Returns null for an unknown token and deletes an expired session', async () => {
		expect(await readSession('unknown')).toBeNull();

		// Past its deadline the session is no session, and its row goes on sight
		const { token, session } = await startSession('1');

		vi.setSystemTime(session.expiresAt);

		expect(await readSession(token)).toBeNull();
		expect(await useDb().select().from(authSessions)).toHaveLength(0);
	});

	test('Slides the idle deadline once half of the idle lifetime passed, and stores it', async () => {
		useAuth().registerSettings({ jwt: { secret: TEST_SECRET }, session: { idleTtl: 30 * MINUTE } });

		const { token, session } = await startSession('1');

		// Early on nothing moves
		vi.setSystemTime(NOW + 5 * MINUTE);
		expect((await readSession(token))?.expiresAt).toBe(session.expiresAt);

		// Past half the idle lifetime the deadline moves forward, and the row carries the new one
		vi.setSystemTime(NOW + 20 * MINUTE);
		expect((await readSession(token))?.expiresAt).toBe(NOW + 50 * MINUTE);

		const [row] = await useDb().select().from(authSessions).where(eq(authSessions.id, session.id));

		expect(row?.expiresAt).toEqual(new Date(NOW + 50 * MINUTE));
	});

	test('Ends one session by token', async () => {
		const { token } = await startSession('1');
		const other = await startSession('1');

		await endSession(token);

		// Only the one named goes
		expect(await readSession(token)).toBeNull();
		expect(await readSession(other.token)).not.toBeNull();
	});

	test('Ends a session by id only for its owner', async () => {
		const { token, session } = await startSession('1');

		// Another user cannot end it with its id
		expect(await endSessionById('2', session.id)).toBe(false);
		expect(await readSession(token)).not.toBeNull();

		// The owner can
		expect(await endSessionById('1', session.id)).toBe(true);
		expect(await readSession(token)).toBeNull();
	});

	test('Ends every session of a user and leaves the others', async () => {
		await startSession('1');
		await startSession('1');

		const stranger = await startSession('2');

		// Both of the user's sessions go
		expect(await endAllSessions('1')).toBe(2);
		expect(await listSessions('1')).toEqual([]);

		// Another user stays signed in
		expect(await readSession(stranger.token)).not.toBeNull();
	});

	test('Lists live sessions, newest first', async () => {
		const first = await startSession('1');

		vi.setSystemTime(NOW + MINUTE);

		const second = await startSession('1');

		await startSession('2');

		// Newest first, the other user's left out
		expect((await listSessions('1')).map((session) => session.id)).toEqual([second.session.id, first.session.id]);

		// Past the first one's deadline only the second is live
		vi.setSystemTime(first.session.expiresAt);
		expect((await listSessions('1')).map((session) => session.id)).toEqual([second.session.id]);
	});

	describe('the session cache', () => {
		test('Serves a started session from the cache without the table', async () => {
			const { token, session } = await startSession('1');

			// The row goes behind the module's back; the cached copy still answers — the documented cost of the cache,
			// bounded by its ttl
			await useDb().delete(authSessions).where(eq(authSessions.id, session.id));

			expect(await readSession(token)).toEqual(session);
		});

		test('Caches a session read from the table on a miss', async () => {
			const { token, session } = await startSession('1');

			// A flushed cache sends the read to the table, which fills the cache again
			await useCache().location().clear();

			expect(await readSession(token)).toEqual(session);
			expect(await useCache().location().get(`auth-session:${session.id}`)).toEqual(session);
		});

		test('Signs out at once: every way of ending a session drops the cached copy', async () => {
			const one = await startSession('1');
			const two = await startSession('1');
			const three = await startSession('1');

			// Each is cached, so a stale copy would answer if an end forgot the cache
			await endSession(one.token);
			await endSessionById('1', two.session.id);

			expect(await readSession(one.token)).toBeNull();
			expect(await readSession(two.token)).toBeNull();

			// Everywhere, by the ids the table returned
			const four = await startSession('1');

			expect(await endAllSessions('1')).toBe(2);
			expect(await readSession(three.token)).toBeNull();
			expect(await readSession(four.token)).toBeNull();
		});

		test('Drops an expired cached session from the table and the cache', async () => {
			const { token, session } = await startSession('1');

			// The cached copy expires like the row; both go on the read that notices
			vi.setSystemTime(session.expiresAt);

			expect(await readSession(token)).toBeNull();
			expect(await useCache().location().get(`auth-session:${session.id}`)).toBeUndefined();
			expect(await useDb().select().from(authSessions)).toEqual([]);
		});

		test('Stores a moved idle deadline in the table and the cache', async () => {
			useAuth().registerSettings({ session: { ttl: 60 * MINUTE, idleTtl: 10 * MINUTE } });

			const { token, session } = await startSession('1');

			// Past half the idle lifetime the deadline moves; both copies carry the new one
			vi.setSystemTime(NOW + 6 * MINUTE);

			const read = await readSession(token);

			expect(read?.expiresAt).toBe(NOW + 16 * MINUTE);
			expect(await useCache().location().get(`auth-session:${session.id}`)).toEqual(read);

			const [row] = await useDb().select().from(authSessions);

			expect(row?.expiresAt).toEqual(new Date(NOW + 16 * MINUTE));
		});

		test('Does not bring back a session ended while its deadline was being moved', async () => {
			useAuth().registerSettings({ session: { ttl: 60 * MINUTE, idleTtl: 10 * MINUTE } });

			const { token, session } = await startSession('1');

			// The row goes while the cached copy stays, as when another request ends it concurrently; the read that
			// would slide the deadline finds nothing to update and drops the copy rather than caching it again
			await useDb().delete(authSessions).where(eq(authSessions.id, session.id));
			vi.setSystemTime(NOW + 6 * MINUTE);

			expect(await readSession(token)).toBeNull();
			expect(await useCache().location().get(`auth-session:${session.id}`)).toBeUndefined();
		});

		test('Falls back to the table when the cache fails', async () => {
			const { token, session } = await startSession('1');

			// A broken cache is logged and skipped: the table still answers
			const location = useCache().location();
			const get = vi.spyOn(location, 'get').mockRejectedValue(new Error('cache down'));

			expect(await readSession(token)).toEqual(session);

			get.mockRestore();
		});
	});
});
