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
import type {
	AuthIdentity,
	AuthorizeParams,
	CallbackParams,
	Credentials,
	OAuthCallbackResult,
	OAuthTokens,
} from '../types.js';
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
 * Tokens a provider issued with a sign-in; secrets that must never reach the filter or an event.
 */
const TOKENS: OAuthTokens = {
	accessToken: 'gho_secret-access-token',
	refreshToken: 'ghr_secret-refresh-token',
	expiresAt: NOW + 28_800_000,
	scope: ['read:user', 'user:email'],
	tokenType: 'bearer',
};

/**
 * What the fake provider was asked to authorize and to exchange, what its exchange throws, if anything, and the tokens
 * it hands on with the identity, if any.
 */
const provider: {
	authorized: AuthorizeParams[];
	exchanged: CallbackParams[];
	failure: unknown;
	tokens: OAuthTokens | undefined;
} = {
	authorized: [],
	exchanged: [],
	failure: undefined,
	tokens: undefined,
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
		// Recorded, so the tests can check what `startOAuth()` sent
		provider.authorized.push(params);

		return new URL(`https://provider.example/authorize?state=${params.state}`);
	}

	/**
	 * Record the exchange and answer with the identity and the tokens a test set, or throw the failure a test set.
	 *
	 * @param params - Code, verifier, nonce and redirect URI.
	 * @returns The identity, with the tokens when a test set them.
	 */
	async callback(params: CallbackParams): Promise<OAuthCallbackResult> {
		// Recorded, so the tests can check what `finishOAuth()` sent
		provider.exchanged.push(params);

		// A test that wants the provider to refuse sets the error it refuses with
		if (provider.failure !== undefined) {
			throw provider.failure;
		}

		// The tokens ride on the identity, the way a driver hands them to `finishOAuth()`
		return provider.tokens ? { ...IDENTITY, tokens: provider.tokens } : IDENTITY;
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
		// Only there so the driver is a form one; never called by the OAuth flow
		return { provider: 'credentials', subject: credentials.identifier };
	}
}

/**
 * Register the fake drivers, the `github` and `google` OAuth locations, the `form` location and the OAuth settings.
 */
const register = (): void => {
	// Two OAuth locations on one driver, so a cookie can be taken to the wrong one
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
	// The state travels through the provider, the cookie through the browser
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
	await expect(attempt).rejects.toMatchObject(INVALID);

	expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
		location,
		reason: 'AUTH_INVALID_TOKEN',
	});

	expect(provider.exchanged).toHaveLength(0);
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as ReturnType<typeof useEmitter>);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
	provider.authorized.length = 0;
	provider.exchanged.length = 0;
	provider.failure = undefined;
	provider.tokens = undefined;
	vi.clearAllMocks();
});

describe('startOAuth', () => {
	test('Hands the driver a state, an S256 challenge, a nonce, the redirect URI and the scopes', async () => {
		register();

		const { url, expiresAt } = await startOAuth('github', { redirectUri: REDIRECT_URI, scopes: ['read:user'] });

		expect(url.origin).toBe('https://provider.example');
		expect(expiresAt).toBe(NOW + DEFAULT_OAUTH_STATE_TTL);

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

		expect(provider.authorized[0]).not.toHaveProperty('scopes');
		expect(expiresAt).toBe(NOW + 60_000);
	});

	test('Seals the secrets into a cookie the browser cannot read', async () => {
		register();

		const { cookie } = await startOAuth('github', { redirectUri: REDIRECT_URI, data: { next: '/secret-page' } });
		const [params] = provider.authorized;

		expect(cookie.startsWith('v2.')).toBe(true);

		for (const value of [params!.state, params!.nonce, REDIRECT_URI, '/secret-page', 'github']) {
			expect(cookie).not.toContain(value);
		}

		expect((await startOAuth('github', { redirectUri: REDIRECT_URI })).cookie).not.toBe(cookie);
		expect(provider.authorized[1]!.state).not.toBe(params!.state);
	});

	test('Refuses to run without an oauth secret of 32 characters', async () => {
		const message = 'The "oauth.secret" auth setting must be at least 32 characters of random data';

		register();
		useAuth().registerSettings({});
		await expect(startOAuth('github', { redirectUri: REDIRECT_URI })).rejects.toThrow(message);

		useAuth().registerSettings({ oauth: { secret: 's'.repeat(31) } });
		await expect(startOAuth('github', { redirectUri: REDIRECT_URI })).rejects.toThrow(message);

		expect(provider.authorized).toHaveLength(0);
	});

	test('Refuses a location whose driver is not an OAuth one', async () => {
		register();

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

		expect(result).toStrictEqual({ identity: IDENTITY });
		expect(emitter.emitFilter).toHaveBeenCalledWith(AUTH_SIGN_IN_FILTER, IDENTITY, { location: 'github' });
		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, { location: 'github', payload: IDENTITY });

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

		await expect(finishOAuth('github', { state, code: 'c', cookie })).resolves.toStrictEqual({
			identity: IDENTITY,
			data: { next: '/billing', count: 2 },
		});
	});

	test('Hands back the tokens of the driver beside the identity, never to the filter or the event', async () => {
		register();
		provider.tokens = TOKENS;

		const { state, cookie } = await start({ next: '/repos' });
		const result = await finishOAuth('github', { state, code: 'c', cookie });

		expect(result).toStrictEqual({ identity: IDENTITY, data: { next: '/repos' }, tokens: TOKENS });
		expect(result.identity).not.toHaveProperty('tokens');

		expect(emitter.emitFilter).toHaveBeenCalledWith(AUTH_SIGN_IN_FILTER, IDENTITY, { location: 'github' });
		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, { location: 'github', payload: IDENTITY });

		const seen = JSON.stringify([...emitter.emitFilter.mock.calls, ...emitter.emitAction.mock.calls]);

		expect(seen).not.toContain(TOKENS.accessToken);
		expect(seen).not.toContain(TOKENS.refreshToken);
		expect(logger.info).not.toHaveBeenCalled();
	});

	test('Refuses a missing cookie', async () => {
		register();

		const { state } = await start();

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: undefined }));
		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: '' }));
	});

	test('Refuses a tampered cookie', async () => {
		register();

		const { state, cookie } = await start();

		const last = cookie.at(-1) === 'A' ? 'B' : 'A';

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: `${cookie.slice(0, -1)}${last}` }));

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie: 'not-a-cookie' }));
	});

	test('Refuses a cookie sealed with another secret', async () => {
		register();

		const { state, cookie } = await start();

		useAuth().registerSettings({ oauth: { secret: 'another-oauth-secret-of-32-characters!' } });

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie }));
	});

	test('Accepts a cookie sealed with an older secret kept for rotation', async () => {
		register();

		const { state, cookie } = await start();

		useAuth().registerSettings({ oauth: { secret: ['another-oauth-secret-of-32-characters!', SECRET] } });

		await expect(finishOAuth('github', { state, code: 'c', cookie })).resolves.toStrictEqual({ identity: IDENTITY });
	});

	test('Refuses an expired cookie', async () => {
		register();

		const { state, cookie } = await start();

		vi.setSystemTime(NOW + DEFAULT_OAUTH_STATE_TTL);

		await expectRefused(finishOAuth('github', { state, code: 'c', cookie }));
	});

	test('Refuses a cookie made for another location', async () => {
		register();

		const { state, cookie } = await start();

		await expectRefused(finishOAuth('google', { state, code: 'c', cookie }), 'google');
	});

	test('Refuses a state that is not the one of the cookie', async () => {
		register();

		const { state, cookie } = await start();

		await expectRefused(finishOAuth('github', { state: `${state}x`, code: 'c', cookie }));
		await expectRefused(finishOAuth('github', { state: undefined as unknown as string, code: 'c', cookie }));
	});

	test('Rethrows the refusal of the provider and announces it', async () => {
		register();

		const { state, cookie } = await start();
		const failure = new AuthProviderFailedError({ provider: 'github', reason: 'bad_verification_code' });

		provider.failure = failure;

		await expect(finishOAuth('github', { state, code: 'c', cookie })).rejects.toBe(failure);

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

		await expect(finishOAuth('form', { state, code: 'c', cookie })).rejects.toThrow(
			'Auth location "form" does not sign in with OAuth',
		);

		// A secret gone from the settings is reported as itself rather than as an invalid cookie
		useAuth().registerSettings({});

		await expect(finishOAuth('github', { state, code: 'c', cookie })).rejects.toThrow(
			'The "oauth.secret" auth setting must be at least 32 characters of random data',
		);

		expect(emitter.emitAction).not.toHaveBeenCalled();
	});
});
