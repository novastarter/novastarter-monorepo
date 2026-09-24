/**
 * Tests of the credentials driver class on the real scrypt of `@novastarter/auth`, at a low cost so a hash takes a
 * millisecond; `verifyPassword` and `hashPassword` are wrapped in spies to see which hash an unknown account is checked
 * against. `@novastarter/logger` is mocked to read the warning of a failed rehash.
 *
 * Covered: the constructor check and the named export of the entry point, a match, a wrong password, an unknown
 * account and one without a password (both against the lazily made dummy hash), the identifier trimming, and the rehash
 * with its failure path.
 */
import { hashPassword, type ScryptParams, verifyPassword } from '@novastarter/auth';
import { isNovastarterError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { AuthDriverCredentials, type AuthDriverCredentialsConfig, type CredentialsUser } from './driver.js';

vi.mock('@novastarter/logger');

vi.mock('@novastarter/auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@novastarter/auth')>();

	// Real functions behind spies, so the tests check real hashes and still see which hash was verified
	return { ...actual, hashPassword: vi.fn(actual.hashPassword), verifyPassword: vi.fn(actual.verifyPassword) };
});

/**
 * The cost every hash of these tests is made with: far below the default, so the suite stays fast.
 */
const PARAMS: ScryptParams = { ln: 4, r: 8, p: 1 };

/**
 * Logger double recording the warning of a failed rehash.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * The account the lookup knows, with its hash made in `beforeEach`.
 */
let alice: CredentialsUser;

/**
 * Build a driver on a lookup that knows `alice` and nobody else.
 *
 * @param overrides - Options to set on top of the lookup and the test cost.
 * @returns The driver and the lookup spy.
 */
const makeDriver = (
	overrides: Partial<ConstructorParameters<typeof AuthDriverCredentials>[0]> = {},
): { driver: AuthDriverCredentials; findUser: ReturnType<typeof vi.fn> } => {
	// Only `alice@example.com` resolves, so every other identifier is an unknown account
	const findUser = vi.fn(async (identifier: string) => (identifier === 'alice@example.com' ? alice : null));

	return { driver: new AuthDriverCredentials({ findUser, params: PARAMS, ...overrides }), findUser };
};

beforeEach(async () => {
	// Made before the spies are cleared, so their counts start at zero in each test
	alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', PARAMS) };

	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(hashPassword).mockClear();
	vi.mocked(verifyPassword).mockClear();
});

afterEach(() => {
	// Only the calls are cleared, so the spies keep wrapping the real implementations
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Refuses a configuration without a findUser function', () => {
		expect(() => new AuthDriverCredentials({} as AuthDriverCredentialsConfig)).toThrow(
			'The credentials auth driver needs a "findUser" function',
		);
	});

	test('Is exported by name from the package entry point', () => {
		expect(entry.AuthDriverCredentials).toBe(AuthDriverCredentials);
	});
});

describe('authenticate', () => {
	test('Answers the credentials identity for a matching password', async () => {
		const { driver, findUser } = makeDriver();

		await expect(
			driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' }),
		).resolves.toStrictEqual({
			provider: 'credentials',
			subject: 'user-1',
		});

		expect(findUser).toHaveBeenCalledWith('alice@example.com');
	});

	test('Trims the identifier and passes it on otherwise as typed', async () => {
		const { driver, findUser } = makeDriver();

		// The case stays, since folding it is the lookup's business
		await driver.authenticate({ identifier: '  alice@example.com\t', password: 'correct horse' });

		await expect(
			driver.authenticate({ identifier: ' Alice@example.com ', password: 'correct horse' }),
		).rejects.toThrow();

		expect(findUser.mock.calls).toStrictEqual([['alice@example.com'], ['Alice@example.com']]);
	});

	test('Refuses a wrong password with InvalidCredentialsError', async () => {
		const { driver } = makeDriver();

		const error = await driver
			.authenticate({ identifier: 'alice@example.com', password: 'wrong' })
			.catch((e: unknown) => e);

		expect(isNovastarterError(error, 'INVALID_CREDENTIALS')).toBe(true);
	});

	test('Checks the password of an unknown account against a dummy hash of the same cost, made once', async () => {
		const { driver } = makeDriver();

		for (const identifier of ['nobody@example.com', 'ghost@example.com']) {
			const error = await driver.authenticate({ identifier, password: 'correct horse' }).catch((e: unknown) => e);

			expect(isNovastarterError(error, 'INVALID_CREDENTIALS')).toBe(true);
		}

		// A scrypt check against a hash of the configured cost keeps the time equal to a real check
		expect(verifyPassword).toHaveBeenCalledTimes(2);

		const dummy = vi.mocked(verifyPassword).mock.calls[0]![1];

		expect(dummy).toMatch(/^\$scrypt\$ln=4,r=8,p=1\$/);
		expect(vi.mocked(verifyPassword).mock.calls[1]![1]).toBe(dummy);

		expect(hashPassword).toHaveBeenCalledTimes(1);
	});

	test('Makes no dummy hash while every account exists', async () => {
		const { driver } = makeDriver();

		await driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' });

		expect(hashPassword).not.toHaveBeenCalled();
	});

	test('Shares one dummy hashing between concurrent first misses', async () => {
		const { driver } = makeDriver();

		await Promise.allSettled([
			driver.authenticate({ identifier: 'a@example.com', password: 'x' }),
			driver.authenticate({ identifier: 'b@example.com', password: 'x' }),
		]);

		expect(hashPassword).toHaveBeenCalledTimes(1);
	});

	test('Treats an account without a password like an unknown one', async () => {
		const { driver } = makeDriver({ findUser: async () => ({ id: 'user-2', passwordHash: null }) });

		// An OAuth-only account has no password hash, and its refusal must look like any other
		const error = await driver
			.authenticate({ identifier: 'bob@example.com', password: 'anything' })
			.catch((e: unknown) => e);

		expect(isNovastarterError(error, 'INVALID_CREDENTIALS')).toBe(true);
		expect(vi.mocked(verifyPassword).mock.calls[0]![1]).toMatch(/^\$scrypt\$ln=4,/);
	});

	test('Treats an empty or non-string identifier as an unknown account without asking the lookup', async () => {
		const { driver, findUser } = makeDriver();

		// The number stands for what an untyped form body can carry
		for (const identifier of ['   ', 42 as unknown as string]) {
			const error = await driver.authenticate({ identifier, password: 'x' }).catch((e: unknown) => e);

			expect(isNovastarterError(error, 'INVALID_CREDENTIALS')).toBe(true);
		}

		expect(findUser).not.toHaveBeenCalled();
		expect(verifyPassword).toHaveBeenCalledTimes(2);
	});
});

describe('rehash', () => {
	test('Hands a hash made with another cost to onRehash, replaced by one of the configured cost', async () => {
		const onRehash = vi.fn(async () => {});
		const { driver } = makeDriver({ onRehash });

		// The stored hash was made with a higher cost than the driver's
		alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', { ln: 5, r: 8, p: 1 }) };

		await driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' });

		expect(onRehash).toHaveBeenCalledTimes(1);

		const [id, hash] = onRehash.mock.calls[0]! as unknown as [string, string];

		expect(id).toBe('user-1');
		expect(hash).toMatch(/^\$scrypt\$ln=4,r=8,p=1\$/);
		await expect(verifyPassword('correct horse', hash)).resolves.toBe(true);
	});

	test('Leaves a hash of the configured cost alone', async () => {
		const onRehash = vi.fn(async () => {});
		const { driver } = makeDriver({ onRehash });

		// Alice's hash was made with the driver's own cost
		await driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' });

		expect(onRehash).not.toHaveBeenCalled();
	});

	test('Does not rehash after a wrong password', async () => {
		const onRehash = vi.fn(async () => {});
		const { driver } = makeDriver({ onRehash });

		// The password does not match, so nothing proves a new hash would be right
		alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', { ln: 5, r: 8, p: 1 }) };

		await expect(driver.authenticate({ identifier: 'alice@example.com', password: 'wrong' })).rejects.toThrow();
		expect(onRehash).not.toHaveBeenCalled();
	});

	test('Signs in with an outdated hash when no onRehash is given', async () => {
		const { driver } = makeDriver();

		alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', { ln: 5, r: 8, p: 1 }) };
		vi.mocked(hashPassword).mockClear();

		await expect(
			driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' }),
		).resolves.toMatchObject({
			subject: 'user-1',
		});

		expect(hashPassword).not.toHaveBeenCalled();
	});

	test('Logs a failing onRehash and still signs the person in', async () => {
		const failure = new Error('database is down');
		const { driver } = makeDriver({ onRehash: vi.fn(async () => Promise.reject(failure)) });

		// The password was proven; a storage hiccup must not turn that into a failed sign-in
		alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', { ln: 5, r: 8, p: 1 }) };

		await expect(
			driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' }),
		).resolves.toStrictEqual({
			provider: 'credentials',
			subject: 'user-1',
		});

		expect(logger.warn).toHaveBeenCalledWith(failure, expect.stringContaining('"user-1"'));
	});

	test('Wraps a non-Error rejection of onRehash before logging it', async () => {
		const { driver } = makeDriver({ onRehash: vi.fn(async () => Promise.reject('nope')) });

		// A string rejection must still reach the logger as an Error, so pino serialises it with a message
		alice = { id: 'user-1', passwordHash: await hashPassword('correct horse', { ln: 5, r: 8, p: 1 }) };

		await driver.authenticate({ identifier: 'alice@example.com', password: 'correct horse' });

		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), expect.any(String));
		expect((logger.warn.mock.calls[0]![0] as Error).message).toBe('nope');
	});
});
