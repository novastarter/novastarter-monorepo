/**
 * Tests of `auth/providers/lib/oauth` on fake drivers registered through `useAuth()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked.
 */
import { createHash } from 'node:crypto';
import { useEmitter } from '@novastarter/emitter';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthProviderFailedError } from '../../errors/index.js';
import { DEFAULT_OAUTH_STATE_TTL } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import type { AuthDriver } from '../driver.js';
import type { AuthIdentity, AuthorizeParams, CallbackParams, Credentials } from '../types.js';
import { AUTH_SIGN_IN_FAILED_EVENT, AUTH_SIGN_IN_FILTER, AUTH_SIGNED_IN_EVENT } from './events.js';
import { finishOAuth, startOAuth } from './oauth.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module '../../lib/auth-manager.js' {
	interface AuthDrivers {
		fake: Record<string, never>;
		fakeForm: Record<string, never>;
	}
}

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * An OAuth secret long enough to be accepted.
 */
const SECRET = 'test-oauth-secret-of-at-least-32-characters';

/**
 * The callback URL every test starts with.
 */
const REDIRECT_URI = 'https://app.example/auth/github/callback';

/**
 * The identity the fake provider vouches for.
 */
const IDENTITY: AuthIdentity = { provider: 'github', subject: '42', email: 'user@example.com' };

/**
 * The error every refused callback comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * Logger double; nothing in the OAuth flow should write to it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the identity back unchanged, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * What the fake provider was asked to authorize and to exchange, and what its exchange throws, if anything.
 */
const provider: { authorized: AuthorizeParams[]; exchanged: CallbackParams[]; failure: unknown } = {
	authorized: [],
	exchanged: [],
	failure: undefined,
};

/**
 * An OAuth driver that records what it is given and vouches for {@link IDENTITY}.
 */
class FakeOAuthDriver implements AuthDriver {
	/**
	 * Record the authorization and build a consent URL carrying the state.
	 *
	 * @param params - State, challenge, nonce, redirect URI and scopes.
	 * @returns The URL.
	 */
	async authorize(params: AuthorizeParams): Promise<URL> {
		// 1. Recorded, so the tests can check what `startOAuth()` sent
		provider.authorized.push(params);

		return new URL(`https://provider.example/authorize?state=${params.state}`);
	}

	/**
	 * Record the exchange and answer with the identity, or throw the failure a test set.
	 *
	 * @param params - Code, verifier, nonce and redirect URI.
	 * @returns The identity.
	 */
	async callback(params: CallbackParams): Promise<AuthIdentity> {
		// 1. Recorded, so the tests can check what `finishOAuth()` sent
		provider.exchanged.push(params);

		// 2. A test that wants the provider to refuse sets the error it refuses with
		if (provider.failure !== undefined) {
			throw provider.failure;
		}

		return IDENTITY;
	}
}

/**
 * A form driver, which cannot sign in with OAuth.
 */
class FakeFormDriver implements AuthDriver {
	/**
	 * Accept anything.
	 *
	 * @param credentials - Identifier and password.
	 * @returns An identity for the identifier.
	 */
	async authenticate(credentials: Credentials): Promise<AuthIdentity> {
		// 1. Only there so the driver is a form one; never called by the OAuth flow
		return { provider: 'credentials', subject: credentials.identifier };
	}
}

/**
 * Register the fake drivers, the `github` and `google` OAuth locations, the `form` location and the OAuth settings.
 */
const register = (): void => {
	// 1. Two OAuth locations on one driver, so a cookie can be taken to the wrong one
	const auth = useAuth();

	auth.registerDriver('fake', FakeOAuthDriver);
	auth.registerDriver('fakeForm', FakeFormDriver);
	auth.registerLocation('github', { driver: 'fake', options: {} });
	auth.registerLocation('google', { driver: 'fake', options: {} });
	auth.registerLocation('form', { driver: 'fakeForm', options: {} });
	auth.registerSettings({ oauth: { secret: SECRET } });
};

/**
 * Start a sign-in through `github` and return the state the provider would send back with its cookie.
 *
 * @param data - What to keep until the callback.
 * @returns The state and the cookie.
 */
const start = async (data?: Record<string, unknown>): Promise<{ state: string; cookie: string }> => {
	// 1. The state travels through the provider, the cookie through the browser
	const { url, cookie } = await startOAuth('github', { redirectUri: REDIRECT_URI, ...(data ? { data } : {}) });

	return { state: url.searchParams.get('state')!, cookie };
};

/**
 * Assert the callback was refused as an invalid token, announced as a failed sign-in, and never reached the provider.
 *
 * @param attempt - The `finishOAuth()` call.
 * @param location - The location it was made for.
 * @returns Once checked.
 */
const expectRefused = async (attempt: Promise<unknown>, location = 'github'): Promise<void> => {
	// 1. One error for every way the cookie can be wrong
	await expect(attempt).rejects.toMatchObject(INVALID);

	// 2. Announced with the error's code, and the code never exchanged
	expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
		location,
		reason: 'AUTH_INVALID_TOKEN',
	});

	expect(provider.exchanged).toHaveLength(0);
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.mocked(useLogger).mockReturnValue(logger as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
	provider.authorized.length = 0;
	provider.exchanged.length = 0;
	provider.failure = undefined;
	vi.clearAllMocks();
});

describe('startOAuth', () => {
	test('Hands the driver a state, an S256 challenge, a nonce, the redirect URI and the scopes', async () => {
		register();

		const { url, expiresAt } = await startOAuth('github', { redirectUri: REDIRECT_URI, scopes: ['read:user'] });

		// 1. The driver's URL is passed on, and the cookie lives for the default state lifetime
		expect(url.origin).toBe('https://provider.example');
		expect(expiresAt).toBe(NOW + DEFAULT_OAUTH_STATE_TTL);

		// 2. Random state and challenge of 256 bits, a nonce of 128, all base64url
		const [params] = provider.authorized;

		expect(params).toStrictEqual({
			state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
			codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
			nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
			redirectUri: REDIRECT_URI,
			scopes: ['read:user'],
		});
	});

	test('Leaves the scopes to the driver when none are given, and takes the lifetime from the settings', async () => {
		register();
		useAuth().registerSettings({ oauth: { secret: SECRET, stateTtl: 60_000 } });

		const { expiresAt } = await startOAuth('github', { redirectUri: REDIRECT_URI });

		// 1. No `scopes` key at all, so the driver's defaults apply
		expect(provider.authorized[0]).not.toHaveProperty('scopes');
		expect(expiresAt).toBe(NOW + 60_000);
	});

	test('Seals the secrets into a cookie the browser cannot read', async () => {
		register();

		const { cookie } = await startOAuth('github', { redirectUri: REDIRECT_URI, data: { next: '/secret-page' } });
		const [params] = provider.authorized;

		// 1. Encrypted: none of the secrets, the redirect URI or the data appear in it
		expect(cookie.startsWith('v1.')).toBe(true);

		for (const value of [params!.state, params!.nonce, REDIRECT_URI, '/secret-page', 'github']) {
			expect(cookie).not.toContain(value);
		}

		// 2. A new cookie and new secrets on every start
		expect((await startOAuth('github', { redirectUri: REDIRECT_URI })).cookie).not.toBe(cookie);
		expect(provider.authorized[1]!.state).not.toBe(params!.state);
	});

	test('Refuses to run without an oauth secret of 32 characters', async () => {
		const message = 'The "oauth.secret" auth setting must be at least 32 characters of random data';

		// 1. Missing, then too short; the driver is never asked
		register();
		useAuth().registerSettings({});
		await expect(startOAuth('github', { redirectUri: REDIRECT_URI })).rejects.toThrow(message);

		useAuth().registerSettings({ oauth: { secret: 's'.repeat(31) } });
		await expect(startOAuth('github', { redirectUri: REDIRECT_URI })).rejects.toThrow(message);

		expect(provider.authorized).toHaveLength(0);
	});

	test('Refuses a location whose driver is not an OAuth one', async () => {
		register();

		// 1. A configuration mistake, named
		await expect(startOAuth('form', { redirectUri: REDIRECT_URI })).rejects.toThrow(
			'Auth location "form" does not sign in with OAuth',
		);
	});
});

describe('finishOAuth', () => {
	test('Exchanges the code with the verifier, the nonce and the redirect URI of the start', async () => {
		register();

		const { state, cookie } = await start();
		const result = await finishOAuth('github', { state, code: 'the-code', cookie });

		// 1. The identity, through the filter and announced
		expect(result).toStrictEqual({ identity: IDENTITY });
		expect(emitter.emitFilter).toHaveBeenCalledWith(AUTH_SIGN_IN_FILTER, IDENTITY, { location: 'github' });
		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, { location: 'github', payload: IDENTITY });

		// 2. The verifier is the one whose S256 the provider was given, and the nonce is the same
		const [authorized] = provider.authorized;
		const [exchanged] = provider.exchanged;

		expect(exchanged).toStrictEqual({
			code: 'the-code',
			codeVerifier: expect.any(String),
			nonce: authorized!.nonce,
			redirectUri: REDIRECT_URI,
		});

		expect(createHash('sha256').update(exchanged!.codeVerifier).digest('base64url')).toBe(authorized!.codeChallenge);
	});

	test('Hands back the data kept since the start', async () => {
		register();

		const { state, cookie } = await start({ next: '/billing', count: 2 });

		// 1. Roundtripped through the cookie as it was given
		await expect(finishOAuth('github', { state, code: 'c', cookie })).resolves.toStrictEqual({
			identity: IDENTITY,
			data: { next: '/billing', count: 2 },
		});
	});

	test('Refuses a missing cookie', async () => {
		register();

		const { state } = await start();

		// 1. No cookie and an empty one alike
		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: undefined }));
		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: '' }));
	});

	test('Refuses a tampered cookie', async () => {
		register();

		const { state, cookie } = await start();

		// 1. One character of the ciphertext changed fails the GCM tag
		const last = cookie.at(-1) === 'A' ? 'B' : 'A';

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: `${cookie.slice(0, -1)}${last}` }));

		// 2. Not in the format at all
		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: 'not-a-cookie' }));
	});

	test('Refuses a cookie sealed with another secret', async () => {
		register();

		const { state, cookie } = await start();

		// 1. The secret rotated between the start and the callback
		useAuth().registerSettings({ oauth: { secret: 'another-oauth-secret-of-32-characters!' } });

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie }));
	});

	test('Refuses an expired cookie', async () => {
		register();

		const { state, cookie } = await start();

		// 1. At the deadline the browser took too long
		vi.setSystemTime(NOW + DEFAULT_OAUTH_STATE_TTL);

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie }));
	});

	test('Refuses a cookie made for another location', async () => {
		register();

		const { state, cookie } = await start();

		// 1. A `github` cookie brought to the `google` callback
		await expectRefused(finishOAuth('google', { state, code: 'c', cookie }), 'google');
	});

	test('Refuses a state that is not the one of the cookie', async () => {
		register();

		const { state, cookie } = await start();

		// 1. Another value, and one that is not a string at all
		await expectRefused(finishOAuth('github', { state: `${state}x`, code: 'c', cookie }));
		await expectRefused(finishOAuth('github', { state: undefined as unknown as string, code: 'c', cookie }));
	});

	test('Rethrows the refusal of the provider and announces it', async () => {
		register();

		const { state, cookie } = await start();
		const failure = new AuthProviderFailedError({ provider: 'github', reason: 'bad_verification_code' });

		provider.failure = failure;

		// 1. The driver's own error reaches the caller
		await expect(finishOAuth('github', { state, code: 'c', cookie })).rejects.toBe(failure);

		// 2. Announced with its code; no filter ran, no sign-in was announced
		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'github',
			reason: 'AUTH_PROVIDER_FAILED',
		});

		expect(emitter.emitFilter).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, expect.anything());
	});

	test('Refuses a location whose driver is not an OAuth one, and a missing secret', async () => {
		register();

		const { state, cookie } = await start();

		// 1. A form location is a configuration mistake, named
		await expect(finishOAuth('form', { state, code: 'c', cookie })).rejects.toThrow(
			'Auth location "form" does not sign in with OAuth',
		);

		// 2. So is a secret gone from the settings, reported as itself rather than as an invalid cookie
		useAuth().registerSettings({});

		await expect(finishOAuth('github', { state, code: 'c', cookie })).rejects.toThrow(
			'The "oauth.secret" auth setting must be at least 32 characters of random data',
		);

		expect(emitter.emitAction).not.toHaveBeenCalled();
	});
});
