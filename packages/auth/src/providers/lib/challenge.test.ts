/**
 * Tests of `auth/providers/lib/challenge` on fake drivers registered through `useAuth()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked; the limiter is the real local one of
 * `@novastarter/memory`.
 */
import { useEmitter } from '@novastarter/emitter';
import { InvalidCredentialsError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_CHALLENGE_TTL } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import type { AuthDriver } from '../driver.js';
import type { AuthIdentity, ChallengeBegun, ChallengeInput, Credentials } from '../types.js';
import {
	CHALLENGE_SIGN_IN_PURPOSE,
	finishChallenge,
	openChallenge,
	sealChallenge,
	startChallenge,
} from './challenge.js';
import { AUTH_SIGN_IN_FAILED_EVENT, AUTH_SIGNED_IN_EVENT } from './events.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module '../../lib/auth-manager.js' {
	interface AuthDrivers {
		fakeChallenge: Record<string, never>;
		fakeStateless: Record<string, never>;
		fakeFormOnly: Record<string, never>;
	}
}

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * A challenge secret long enough to be accepted.
 */
const SECRET = 'test-challenge-secret-of-32-characters!';

/**
 * Logger double; nothing in the challenge flow should write to it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the identity back unchanged, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * What the fake drivers were handed at the second step.
 */
const completed: { input: ChallengeInput; state: Record<string, unknown> | undefined }[] = [];

/**
 * A driver that keeps state — like a passkey — and accepts the answer `ok` only.
 */
class FakeChallengeDriver implements AuthDriver {
	/**
	 * Hand the browser options and keep a challenge for the second step.
	 *
	 * @returns Options and state.
	 */
	async begin(): Promise<ChallengeBegun> {
		// A fixed challenge, so the tests can check it comes back through the cookie
		return { options: { challenge: 'abc' }, state: { challenge: 'abc' } };
	}

	/**
	 * Record the second step and accept the answer `ok` only.
	 *
	 * @param input - What the browser sent back.
	 * @param state - The opened state.
	 * @returns An identity.
	 */
	async complete(input: ChallengeInput, state: Record<string, unknown> | undefined): Promise<AuthIdentity> {
		// Recorded, so the tests can check what `finishChallenge()` passed on
		completed.push({ input, state });

		// Anything but the right answer is a refusal, as a real driver would make it
		if (input['answer'] !== 'ok') {
			throw new InvalidCredentialsError();
		}

		return { provider: 'fake', subject: '42' };
	}
}

/**
 * A driver that keeps no state — like a link sent by mail.
 */
class FakeStatelessDriver implements AuthDriver {
	/**
	 * Send nothing and keep nothing.
	 *
	 * @returns No options, no state.
	 */
	async begin(): Promise<ChallengeBegun> {
		// A link driver mails the token; the browser gets nothing to carry
		return {};
	}

	/**
	 * Record the second step and accept it.
	 *
	 * @param input - What the browser sent back.
	 * @param state - Always `undefined` here.
	 * @returns An identity.
	 */
	async complete(input: ChallengeInput, state: Record<string, unknown> | undefined): Promise<AuthIdentity> {
		// Recorded, so the tests can check no state was invented
		completed.push({ input, state });

		return { provider: 'stateless', subject: '7' };
	}
}

/**
 * A form driver, which has no two-step sign-in.
 */
class FakeFormOnlyDriver implements AuthDriver {
	/**
	 * Accept anything.
	 *
	 * @param credentials - Identifier and password.
	 * @returns An identity for the identifier.
	 */
	async authenticate(credentials: Credentials): Promise<AuthIdentity> {
		// Only there so the driver is a form one; never called by the challenge flow
		return { provider: 'credentials', subject: credentials.identifier };
	}
}

/**
 * Register the fake drivers, their locations and the challenge settings.
 *
 * @param signInLimiter - The `signIn` limiter of the settings, if the test wants one.
 */
const register = (signInLimiter?: LimiterDriverLocal): void => {
	// Two locations on the stateful driver, so a cookie can be taken to the wrong one
	const auth = useAuth();

	auth.registerDriver('fakeChallenge', FakeChallengeDriver);
	auth.registerDriver('fakeStateless', FakeStatelessDriver);
	auth.registerDriver('fakeFormOnly', FakeFormOnlyDriver);
	auth.registerLocation('passkey', { driver: 'fakeChallenge', options: {} });
	auth.registerLocation('other', { driver: 'fakeChallenge', options: {} });
	auth.registerLocation('link', { driver: 'fakeStateless', options: {} });
	auth.registerLocation('form', { driver: 'fakeFormOnly', options: {} });
	auth.registerSettings({ challenge: { secret: SECRET }, limiters: { signIn: signInLimiter } });
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as ReturnType<typeof useEmitter>);
	register();
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
	completed.length = 0;
	vi.clearAllMocks();
});

describe('sealChallenge / openChallenge', () => {
	test('Round-trips the state for the same location and purpose only', () => {
		const { cookie, expiresAt } = sealChallenge('passkey', 'registration', { challenge: 'x' });

		expect(expiresAt).toBe(NOW + DEFAULT_CHALLENGE_TTL);
		expect(openChallenge('passkey', 'registration', cookie)).toStrictEqual({ challenge: 'x' });

		expect(openChallenge('other', 'registration', cookie)).toBeNull();
		expect(openChallenge('passkey', CHALLENGE_SIGN_IN_PURPOSE, cookie)).toBeNull();
		expect(openChallenge('passkey', 'registration', `${cookie.slice(0, -2)}AA`)).toBeNull();
		expect(openChallenge('passkey', 'registration', undefined)).toBeNull();
	});

	test('Refuses an expired cookie and opens one sealed with a secret being rotated out', () => {
		const { cookie } = sealChallenge('passkey', 'registration', { challenge: 'x' });

		useAuth().registerSettings({ challenge: { secret: ['another-challenge-secret-of-32-chars!', SECRET] } });

		expect(openChallenge('passkey', 'registration', cookie)).toStrictEqual({ challenge: 'x' });

		vi.setSystemTime(NOW + DEFAULT_CHALLENGE_TTL);

		expect(openChallenge('passkey', 'registration', cookie)).toBeNull();
	});

	test('Refuses to run without a usable secret', () => {
		// A missing or short secret is a configuration mistake, never a default
		useAuth().registerSettings({});

		expect(() => sealChallenge('passkey', 'registration', {})).toThrow(/challenge\.secret/);
		expect(() => openChallenge('passkey', 'registration', 'anything')).toThrow(/challenge\.secret/);
	});
});

describe('startChallenge / finishChallenge', () => {
	test('Carries the state of a stateful driver through the cookie and signs in', async () => {
		const started = await startChallenge('passkey');

		expect(started.options).toStrictEqual({ challenge: 'abc' });
		expect(started.expiresAt).toBe(NOW + DEFAULT_CHALLENGE_TTL);

		await expect(
			finishChallenge('passkey', { input: { answer: 'ok' }, cookie: started.cookie }),
		).resolves.toStrictEqual({ provider: 'fake', subject: '42' });

		expect(completed).toStrictEqual([{ input: { answer: 'ok' }, state: { challenge: 'abc' } }]);

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGNED_IN_EVENT, {
			location: 'passkey',
			payload: { provider: 'fake', subject: '42' },
		});
	});

	test('Hands out no cookie for a stateless driver and finishes without one', async () => {
		// Nothing to carry: a link may be opened in another browser
		await expect(startChallenge('link', { identifier: 'a@example.com' })).resolves.toStrictEqual({
			options: undefined,
			cookie: undefined,
			expiresAt: undefined,
		});

		await expect(finishChallenge('link', { input: { token: 't' } })).resolves.toStrictEqual({
			provider: 'stateless',
			subject: '7',
		});

		expect(completed).toStrictEqual([{ input: { token: 't' }, state: undefined }]);
	});

	test('Refuses a cookie of another location or a tampered one, before the driver is asked', async () => {
		const { cookie } = await startChallenge('passkey');

		await expect(finishChallenge('other', { input: { answer: 'ok' }, cookie })).rejects.toMatchObject({
			code: 'AUTH_INVALID_TOKEN',
		});

		await expect(finishChallenge('passkey', { input: { answer: 'ok' }, cookie: 'v2.x.y.z' })).rejects.toMatchObject({
			code: 'AUTH_INVALID_TOKEN',
		});

		expect(completed).toHaveLength(0);

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'other',
			reason: 'AUTH_INVALID_TOKEN',
		});
	});

	test("Announces and rethrows the driver's refusal", async () => {
		const { cookie } = await startChallenge('passkey');

		await expect(finishChallenge('passkey', { input: { answer: 'no' }, cookie })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		expect(emitter.emitAction).toHaveBeenCalledWith(AUTH_SIGN_IN_FAILED_EVENT, {
			location: 'passkey',
			reason: 'INVALID_CREDENTIALS',
		});
	});

	test('Charges the limiter per location and identifier at the start', async () => {
		useAuth.reset();
		register(new LimiterDriverLocal({ points: 2, duration: 60 }));

		await startChallenge('link', { identifier: 'a@example.com' });
		await startChallenge('link', { identifier: ' A@example.com ' });

		await expect(startChallenge('link', { identifier: 'a@example.com' })).rejects.toMatchObject({
			code: 'REQUESTS_EXCEEDED',
		});

		await expect(startChallenge('link', { identifier: 'b@example.com' })).resolves.toBeDefined();
	});

	test('Refuses a location whose driver has no two-step sign-in', async () => {
		await expect(startChallenge('form')).rejects.toThrow('Auth location "form" does not sign in with a challenge');

		await expect(finishChallenge('form', { input: {} })).rejects.toThrow(
			'Auth location "form" does not sign in with a challenge',
		);
	});
});
