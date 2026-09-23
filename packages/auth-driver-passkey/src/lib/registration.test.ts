/**
 * Tests of the passkey registration functions on the real `useAuth()` and challenge cookie of `@novastarter/auth`,
 * with `@simplewebauthn/server` mocked.
 *
 * Covered: the round trip through the cookie, a cookie for another account, a missing or broken cookie, and a location
 * whose driver is not the passkey one.
 */
import { AuthInvalidTokenError, useAuth } from '@novastarter/auth';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthDriverPasskey } from './driver.js';
import { finishPasskeyRegistration, startPasskeyRegistration } from './registration.js';

vi.mock('@simplewebauthn/server');

// The fake driver joins the driver map the way a driver package does, so its registration type-checks
declare module '@novastarter/auth' {
	interface AuthDrivers {
		fakeForm: Record<string, never>;
	}
}

/**
 * A driver that is not the passkey one.
 */
class FakeFormDriver {}

/**
 * A browser answer; its content is the mocked library's business.
 */
const RESPONSE = { id: 'cred-2' } as never;

beforeEach(() => {
	// 1. A passkey location, another location on another driver, and the secret the cookie is sealed with
	const auth = useAuth();

	auth.registerDriver('passkey', AuthDriverPasskey);
	auth.registerDriver('fakeForm', FakeFormDriver as never);

	auth.registerLocation('passkey', {
		driver: 'passkey',
		options: {
			rpId: 'example.com',
			rpName: 'Example',
			origin: 'https://example.com',
			findCredential: async () => null,
			updateCounter: async () => undefined,
		},
	});

	auth.registerLocation('form', { driver: 'fakeForm', options: {} });
	auth.registerSettings({ challenge: { secret: 'test-challenge-secret-of-32-characters!' } });

	vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: 'reg-1' } as never);

	vi.mocked(verifyRegistrationResponse).mockResolvedValue({
		verified: true,
		registrationInfo: {
			credential: { id: 'cred-2', publicKey: new Uint8Array([9]), counter: 0 },
			credentialDeviceType: 'singleDevice',
			credentialBackedUp: false,
		},
	} as never);
});

afterEach(() => {
	useAuth.reset();
	vi.clearAllMocks();
});

describe('startPasskeyRegistration / finishPasskeyRegistration', () => {
	test('Carries the challenge through the cookie and hands back the key for the account', async () => {
		const started = await startPasskeyRegistration('passkey', { userId: 'user-1', userName: 'a@example.com' });

		// 1. The browser gets the options; the cookie carries their challenge
		expect(started.options).toStrictEqual({ challenge: 'reg-1' });

		await expect(
			finishPasskeyRegistration('passkey', { userId: 'user-1', response: RESPONSE, cookie: started.cookie }),
		).resolves.toMatchObject({ id: 'cred-2', userId: 'user-1' });

		expect(verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: 'reg-1' }));
	});

	test('Refuses a cookie of another account, a missing one and a broken one', async () => {
		const { cookie } = await startPasskeyRegistration('passkey', { userId: 'user-1', userName: 'a@example.com' });

		// 1. Every case is the same refusal, and the library is never asked
		for (const params of [
			{ userId: 'user-2', cookie },
			{ userId: 'user-1', cookie: undefined },
			{ userId: 'user-1', cookie: 'v2.x.y.z' },
		]) {
			await expect(finishPasskeyRegistration('passkey', { ...params, response: RESPONSE })).rejects.toBeInstanceOf(
				AuthInvalidTokenError,
			);
		}

		expect(verifyRegistrationResponse).not.toHaveBeenCalled();
	});

	test('Refuses a location whose driver is not the passkey one', async () => {
		// 1. A configuration mistake, reported as itself
		await expect(startPasskeyRegistration('form', { userId: 'user-1', userName: 'a' })).rejects.toThrow(
			'Auth location "form" is not a passkey one',
		);
	});
});
