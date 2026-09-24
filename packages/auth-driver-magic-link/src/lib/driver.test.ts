/**
 * Tests of the magic-link driver class on the real `createToken()` / `checkToken()` of `@novastarter/auth`, with an
 * in-memory map standing in for the application's token table.
 *
 * Covered: the constructor check and the named export of the entry point, the input checks, a link and a code for an
 * account, the silent refusals for an unknown address, a sign-up link, a send that is not awaited and a failing
 * reporter, a spent, expired and wrong token, and the lifetimes.
 */
import { AuthInvalidTokenError, DEFAULT_CODE_TTL, type TokenRecord, useAuth } from '@novastarter/auth';
import { InvalidPayloadError } from '@novastarter/errors';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import {
	AuthDriverMagicLink,
	type AuthDriverMagicLinkConfig,
	MAGIC_LINK_PURPOSE,
	type MagicLinkMessage,
} from './driver.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * The application's token table: records by purpose and id, as `issue` stores them and `spend` takes them out.
 */
const table = new Map<string, TokenRecord>();

/**
 * What `send` was asked to send.
 */
const sent: MagicLinkMessage[] = [];

/**
 * Build a driver whose lookup knows `alice@example.com` only, over the in-memory table.
 *
 * @param overrides - Options to set on top of the callbacks.
 * @returns The driver.
 */
const makeDriver = (overrides: Partial<AuthDriverMagicLinkConfig> = {}): AuthDriverMagicLink => {
	// The callbacks an application would write over its own tables and mailer
	return new AuthDriverMagicLink({
		findUser: async (email) => (email === 'alice@example.com' ? { id: 'user-1' } : null),
		issue: async (record) => {
			table.set(`${record.purpose}:${record.id}`, record);
		},
		spend: async (id, purpose) => {
			const record = table.get(`${purpose}:${id}`);

			table.delete(`${purpose}:${id}`);

			return record;
		},
		send: async (message) => {
			sent.push(message);
		},
		...overrides,
	});
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
	table.clear();
	sent.length = 0;
});

describe('constructor', () => {
	test('Refuses options without one of the callbacks, and is exported by name from the entry point', () => {
		expect(() => makeDriver({ send: undefined as never })).toThrow('The magic-link driver needs a "send" function');
		expect(entry.AuthDriverMagicLink).toBe(AuthDriverMagicLink);
	});
});

describe('begin', () => {
	test('Refuses a missing address and an unknown format', async () => {
		const driver = makeDriver();

		// What a broken form would send
		await expect(driver.begin({})).rejects.toBeInstanceOf(InvalidPayloadError);
		await expect(driver.begin({ identifier: '  ' })).rejects.toBeInstanceOf(InvalidPayloadError);

		await expect(driver.begin({ identifier: 'alice@example.com', format: 'sms' })).rejects.toBeInstanceOf(
			InvalidPayloadError,
		);
	});

	test('Stores and sends a link for an account, with the default lifetime', async () => {
		await expect(makeDriver().begin({ identifier: ' alice@example.com ' })).resolves.toStrictEqual({});

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ email: 'alice@example.com', format: 'link', userId: 'user-1' });

		const [record] = table.values();

		expect(record).toMatchObject({
			purpose: MAGIC_LINK_PURPOSE,
			userId: 'user-1',
			data: { email: 'alice@example.com' },
			expiresAt: NOW + 60 * 60 * 1000,
		});
	});

	test('Sends a six-digit code for an account, with the code lifetime', async () => {
		await makeDriver().begin({ identifier: 'alice@example.com', format: 'code' });

		expect(sent[0]!.token).toMatch(/^\d{6}$/);
		expect(sent[0]!.expiresAt).toBe(NOW + DEFAULT_CODE_TTL);
	});

	test('Sends nothing to an unknown address, and the same empty answer', async () => {
		const driver = makeDriver();

		// Neither a link nor a code, so the response does not reveal whether the account exists
		await expect(driver.begin({ identifier: 'bob@example.com' })).resolves.toStrictEqual({});
		await expect(driver.begin({ identifier: 'bob@example.com', format: 'code' })).resolves.toStrictEqual({});

		expect(sent).toHaveLength(0);
		expect(table.size).toBe(0);
	});

	test('Sends a sign-up link to an unknown address when allowed, but never a code', async () => {
		const driver = makeDriver({ signUp: true, ttl: 5_000 });

		await driver.begin({ identifier: 'bob@example.com' });

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ email: 'bob@example.com', userId: undefined, expiresAt: NOW + 5_000 });

		// A code needs an account whatever `signUp` says
		await driver.begin({ identifier: 'bob@example.com', format: 'code' });

		expect(sent).toHaveLength(1);
	});

	test('Answers before the mail is sent, and reports a failed send without rejecting', async () => {
		// `begin()` must still answer, so the timing matches an unknown address
		const pending = makeDriver({ send: () => new Promise<void>(() => {}) });

		await expect(pending.begin({ identifier: 'alice@example.com' })).resolves.toStrictEqual({});

		const onSendError = vi.fn();
		const error = new Error('SMTP down');

		await expect(
			makeDriver({ send: async () => Promise.reject(error), onSendError }).begin({ identifier: 'alice@example.com' }),
		).resolves.toStrictEqual({});

		await expect(
			makeDriver({
				send: () => {
					throw error;
				},
				onSendError,
			}).begin({ identifier: 'alice@example.com' }),
		).resolves.toStrictEqual({});

		await vi.waitFor(() => expect(onSendError).toHaveBeenCalledTimes(2));
		expect(onSendError).toHaveBeenCalledWith(error, 'alice@example.com');

		await expect(
			makeDriver({ send: async () => Promise.reject(error) }).begin({ identifier: 'alice@example.com' }),
		).resolves.toStrictEqual({});
	});

	test('Drops a reporter that throws or rejects instead of leaving an unhandled rejection', async () => {
		// Unhandled rejections are caught for the duration of the test, since vitest would only report them after it
		const unhandled: unknown[] = [];
		const listener = (reason: unknown): number => unhandled.push(reason);

		process.on('unhandledRejection', listener);

		try {
			const failure = new Error('logger down');

			const throwing = vi.fn(() => {
				throw failure;
			});

			const rejecting = vi.fn(async () => Promise.reject(failure));

			for (const onSendError of [throwing, rejecting]) {
				await expect(
					makeDriver({ send: async () => Promise.reject(new Error('SMTP down')), onSendError }).begin({
						identifier: 'alice@example.com',
					}),
				).resolves.toStrictEqual({});
			}

			await vi.waitFor(() => {
				expect(throwing).toHaveBeenCalledOnce();
				expect(rejecting).toHaveBeenCalledOnce();
			});

			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(unhandled).toStrictEqual([]);
		} finally {
			// Restored so other tests see their own rejections
			process.off('unhandledRejection', listener);
		}
	});
});

describe('complete', () => {
	test('Signs an account in with its link, once', async () => {
		const driver = makeDriver();

		await driver.begin({ identifier: 'alice@example.com' });

		await expect(driver.complete({ token: sent[0]!.token })).resolves.toStrictEqual({
			provider: 'magic-link',
			subject: 'user-1',
			email: 'alice@example.com',
			emailVerified: true,
		});

		await expect(driver.complete({ token: sent[0]!.token })).rejects.toBeInstanceOf(AuthInvalidTokenError);
	});

	test('Signs an account in with its code and address', async () => {
		const driver = makeDriver();

		await driver.begin({ identifier: 'alice@example.com', format: 'code' });

		// Without the address a code is looked up as a link and not found
		await expect(driver.complete({ token: sent[0]!.token })).rejects.toBeInstanceOf(AuthInvalidTokenError);

		await driver.begin({ identifier: 'alice@example.com', format: 'code' });

		await expect(driver.complete({ token: sent[1]!.token, identifier: 'alice@example.com' })).resolves.toMatchObject({
			subject: 'user-1',
		});
	});

	test('Answers a sign-up link with the address as subject', async () => {
		const driver = makeDriver({ signUp: true });

		await driver.begin({ identifier: 'bob@example.com' });

		await expect(driver.complete({ token: sent[0]!.token })).resolves.toStrictEqual({
			provider: 'magic-link',
			subject: 'bob@example.com',
			email: 'bob@example.com',
			emailVerified: true,
			raw: { signUp: true },
		});
	});

	test('Refuses a missing, unknown or expired token, and a code for an unknown address', async () => {
		const driver = makeDriver();

		await expect(driver.complete({})).rejects.toBeInstanceOf(AuthInvalidTokenError);
		await expect(driver.complete({ token: 'nope' })).rejects.toBeInstanceOf(AuthInvalidTokenError);

		await expect(driver.complete({ token: '123456', identifier: 'bob@example.com' })).rejects.toBeInstanceOf(
			AuthInvalidTokenError,
		);

		await driver.begin({ identifier: 'alice@example.com' });
		vi.setSystemTime(NOW + 60 * 60 * 1000);

		await expect(driver.complete({ token: sent[0]!.token })).rejects.toBeInstanceOf(AuthInvalidTokenError);
	});
});
