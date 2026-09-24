/**
 * Tests of `auth/providers/lib/sign-in` on fake drivers registered through `useAuth()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked; the limiter is the real local one of
 * `@novastarter/memory`.
 */
import { useEmitter } from '@novastarter/emitter';
import { InvalidCredentialsError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../../lib/use-auth.js';
import type { AuthDriver } from '../driver.js';
import type { AuthIdentity, AuthorizeParams, Credentials } from '../types.js';
import { AUTH_SIGN_IN_FAILED_EVENT, AUTH_SIGN_IN_FILTER, AUTH_SIGNED_IN_EVENT } from './events.js';
import { signIn } from './sign-in.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module '../../lib/auth-manager.js' {
	interface AuthDrivers {
		fake: Record<string, never>;
		fakeOAuth: Record<string, never>;
	}
}

/**
 * Logger double; nothing in `signIn()` should write to it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the identity back unchanged unless a test says otherwise, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * Every set of credentials the fake driver was asked to check.
 */
const checked: Credentials[] = [];

/**
 * A credentials driver that accepts the password `right` for any identifier.
 */
class FakeCredentialsDriver implements AuthDriver {
	/**
	 * Check the password.
	 *
	 * @param credentials - Identifier and password.
	 * @returns An identity whose subject is the identifier as typed.
	 * @throws InvalidCredentialsError for any other password.
	 */
	async authenticate(credentials: Credentials): Promise<AuthIdentity> {
		// Recorded, so the tests can tell whether the driver was reached at all
		checked.push(credentials);

		// One fixed password, so a test picks success or failure by what it types
		if (credentials.password !== 'right') {
			throw new InvalidCredentialsError();
		}

		return { provider: 'credentials', subject: `id:${credentials.identifier}`, email: credentials.identifier };
	}
}

/**
 * An OAuth-only driver, which cannot check credentials.
 */
class FakeOAuthDriver implements AuthDriver {
	/**
	 * Build a fixed consent URL.
	 *
	 * @param params - Ignored.
	 * @returns The URL.
	 */
	async authorize(params: AuthorizeParams): Promise<URL> {
		// Only there so the driver is an OAuth one; never called by `signIn()`
		return new URL(`https://provider.example/authorize?state=${params.state}`);
	}
}

/**
 * Register the fake drivers and their locations: `credentials`, `staff` (both credentials) and `github` (OAuth).
 *
 * @param signInLimiter - The `signIn` limiter of the settings, if the test wants one.
 */
const register = (signInLimiter?: LimiterDriverLocal): void => {
	// Every location the tests use; the limiter is the only setting `signIn()` reads
	const auth = useAuth();

	auth.registerDriver('fake', FakeCredentialsDriver);
	auth.registerDriver('fakeOAuth', FakeOAuthDriver);
	auth.registerLocation('credentials', { driver: 'fake', options: {} });
	auth.registerLocation('staff', { driver: 'fake', options: {} });
	auth.registerLocation('github', { driver: 'fakeOAuth', options: {} });
	auth.registerSettings({ limiters: { signIn: signInLimiter } });
};

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as ReturnType<typeof useEmitter>);
});

afterEach(() => {
	useAuth.reset();
	checked.length = 0;
	vi.clearAllMocks();
});

describe('signIn', () => {
	test('Returns the identity the driver proved, after the filter, and announces the sign-in', async () => {
		register();

		const identity = await signIn('credentials', { identifier: 'user@example.com', password: 'right' });

		const expected = { provider: 'credentials', subject: 'id:user@example.com', email: 'user@example.com' };

		expect(identity).toStrictEqual(expected);
		expect(emitter.emitFilter).toHaveBeenCalledWith(AUTH_SIGN_IN_FILTER, expected, { location: 'credentials' });

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, {
			location: 'credentials',
			payload: expected,
		});

		expect(emitter.emitAction).toHaveBeenCalledTimes(1);
	});

	test('Returns what the filter made of the identity', async () => {
		register();

		emitter.emitFilter.mockImplementationOnce(async (_event: string, payload: unknown) => ({
			...(payload as AuthIdentity),
			name: 'From filter',
		}));

		expect(await signIn('credentials', { identifier: 'a', password: 'right' })).toMatchObject({ name: 'From filter' });
	});

	test('Rethrows the refusal of the driver and announces it with its code', async () => {
		register();

		await expect(signIn('credentials', { identifier: 'a', password: 'wrong' })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'credentials',
			reason: 'INVALID_CREDENTIALS',
		});

		expect(emitter.emitFilter).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, expect.anything());
	});

	test('Refuses the sign-in when a filter vetoes it, as wrong credentials', async () => {
		register();

		// `null` from the filter: the client sees the same error as a wrong password
		emitter.emitFilter.mockResolvedValueOnce(null);

		await expect(signIn('credentials', { identifier: 'a', password: 'right' })).rejects.toMatchObject({
			code: 'INVALID_CREDENTIALS',
		});

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'credentials',
			provider: 'credentials',
			reason: 'filter',
		});

		expect(emitter.emitAction).not.toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, expect.anything());
	});

	test('Charges the limiter per location and identifier, folding case and spaces', async () => {
		register(new LimiterDriverLocal({ points: 2, duration: 60 }));

		await expect(signIn('credentials', { identifier: ' User@Example.com ', password: 'x' })).rejects.toMatchObject({
			code: 'INVALID_CREDENTIALS',
		});

		await expect(signIn('credentials', { identifier: 'user@example.com', password: 'x' })).rejects.toMatchObject({
			code: 'INVALID_CREDENTIALS',
		});

		await expect(signIn('credentials', { identifier: 'USER@example.com', password: 'right' })).rejects.toMatchObject({
			code: 'REQUESTS_EXCEEDED',
		});

		expect(checked).toHaveLength(2);

		await expect(signIn('credentials', { identifier: 'other@example.com', password: 'right' })).resolves.toBeDefined();
		await expect(signIn('staff', { identifier: 'user@example.com', password: 'right' })).resolves.toBeDefined();
	});

	test('Clears the count after a success, so earlier typos do not linger', async () => {
		register(new LimiterDriverLocal({ points: 2, duration: 60 }));

		const credentials = { identifier: 'user@example.com', password: 'x' };

		await expect(signIn('credentials', credentials)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await signIn('credentials', { ...credentials, password: 'right' });

		await expect(signIn('credentials', credentials)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(signIn('credentials', credentials)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(signIn('credentials', credentials)).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });
	});

	test('Refuses a location whose driver cannot check credentials, or that does not exist', async () => {
		register(new LimiterDriverLocal({ points: 1, duration: 60 }));

		await expect(signIn('github', { identifier: 'a', password: 'right' })).rejects.toMatchObject({
			code: 'INVALID_CONFIG',
			message: expect.stringContaining('Auth location "github" does not sign in with credentials'),
		});

		await expect(signIn('nope', { identifier: 'a', password: 'right' })).rejects.toThrow(
			'Location "nope" doesn\'t exist',
		);

		expect(emitter.emitAction).not.toHaveBeenCalled();
	});
});
