/**
 * Tests of `auth/sessions/check-session`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import type { SessionRecord } from '../types.js';
import { checkSession } from './check-session.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * The idle lifetime of the tests that set one: ten minutes.
 */
const IDLE = 10 * 60 * 1000;

/**
 * Build a session record with the given deadlines.
 *
 * @param expiresAt - The idle deadline.
 * @param absoluteExpiresAt - The hard end; a day from {@link NOW} unless given.
 * @returns The record.
 */
const record = (expiresAt: number, absoluteExpiresAt: number = NOW + 24 * 60 * 60 * 1000): SessionRecord => {
	// Only the deadlines matter to the check; the rest is fixed
	return { id: 'hash', userId: 'user-1', createdAt: NOW - 1_000, expiresAt, absoluteExpiresAt };
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('checkSession', () => {
	test('Judges a missing session invalid', () => {
		expect(checkSession(undefined)).toStrictEqual({ status: 'invalid' });
		expect(checkSession(null)).toStrictEqual({ status: 'invalid' });
	});

	test('Judges a session at or past its deadline invalid', () => {
		expect(checkSession(record(NOW))).toStrictEqual({ status: 'invalid' });
		expect(checkSession(record(NOW - 1))).toStrictEqual({ status: 'invalid' });
	});

	test('Never extends a session without an idle lifetime', () => {
		const session = record(NOW + 1_000);

		expect(checkSession(session)).toStrictEqual({ status: 'valid', session, extended: false });
	});

	test('Leaves the deadline alone while more than half the idle lifetime remains', () => {
		useAuth().registerSettings({ session: { idleTtl: IDLE } });

		const session = record(NOW + IDLE / 2);

		expect(checkSession(session)).toStrictEqual({ status: 'valid', session, extended: false });
	});

	test('Slides the deadline a full idle lifetime once under half remains', () => {
		useAuth().registerSettings({ session: { idleTtl: IDLE } });

		const session = record(NOW + IDLE / 2 - 1);
		const check = checkSession(session);

		expect(check).toStrictEqual({ status: 'valid', session: { ...session, expiresAt: NOW + IDLE }, extended: true });

		expect(session.expiresAt).toBe(NOW + IDLE / 2 - 1);
	});

	test('Caps the slide at the hard end', () => {
		useAuth().registerSettings({ session: { idleTtl: IDLE } });

		const session = record(NOW + 60_000, NOW + 120_000);

		expect(checkSession(session)).toStrictEqual({
			status: 'valid',
			session: { ...session, expiresAt: NOW + 120_000 },
			extended: true,
		});
	});

	test('Does not extend a session already at its hard end', () => {
		useAuth().registerSettings({ session: { idleTtl: IDLE } });

		// Nothing is left to slide, so no pointless write is asked for
		const session = record(NOW + 60_000, NOW + 60_000);

		expect(checkSession(session)).toStrictEqual({ status: 'valid', session, extended: false });
	});

	test('Keeps an active session alive until its hard end, then drops it', () => {
		useAuth().registerSettings({ session: { idleTtl: IDLE } });

		let session = record(NOW + IDLE, NOW + 30 * 60 * 1000);

		for (let minute = 6; minute < 30; minute += 6) {
			vi.setSystemTime(NOW + minute * 60 * 1000);

			const check = checkSession(session);

			expect(check.status).toBe('valid');

			if (check.status === 'valid') {
				session = check.session;
			}
		}

		vi.setSystemTime(NOW + 30 * 60 * 1000);
		expect(checkSession(session)).toStrictEqual({ status: 'invalid' });
	});
});
