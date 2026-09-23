/**
 * Tests of the passkey driver class with `@simplewebauthn/server` mocked: the WebAuthn checks are the library's, the
 * driver's part is what it hands the library and what it makes of the verdict.
 *
 * Covered: the constructor checks and the default export, the sign-in options and state, a verified answer with its
 * counter, the refusals (no challenge, unknown key, failed or throwing verification), and the registration options and
 * record.
 */
import { AuthInvalidTokenError } from '@novastarter/auth';
import { InvalidCredentialsError } from '@novastarter/errors';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { AuthDriverPasskey, type AuthDriverPasskeyConfig, type PasskeyCredential } from './driver.js';

vi.mock('@simplewebauthn/server');

/**
 * The key the lookup knows.
 */
const KEY: PasskeyCredential = {
	id: 'cred-1',
	userId: 'user-1',
	publicKey: Buffer.from([1, 2, 3]).toString('base64url'),
	counter: 5,
	transports: ['internal'],
};

/**
 * A browser answer naming {@link KEY}; its content is the mocked library's business.
 */
const RESPONSE = { id: 'cred-1' } as never;

/**
 * Build a driver whose lookup knows {@link KEY} only.
 *
 * @param overrides - Options to set on top of the defaults.
 * @returns The driver and its counter spy.
 */
const makeDriver = (
	overrides: Partial<AuthDriverPasskeyConfig> = {},
): { driver: AuthDriverPasskey; updateCounter: ReturnType<typeof vi.fn> } => {
	// 1. The relying party of a site on example.com, and a lookup over one key
	const updateCounter = vi.fn(async () => undefined);

	const driver = new AuthDriverPasskey({
		rpId: 'example.com',
		rpName: 'Example',
		origin: 'https://example.com',
		findCredential: async (id) => (id === KEY.id ? KEY : null),
		updateCounter,
		...overrides,
	});

	return { driver, updateCounter };
};

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Refuses a missing relying party or callback, and is the default export', () => {
		// 1. Each is needed; a missing one fails at the location's first use
		expect(() => makeDriver({ rpId: '' })).toThrow('The passkey driver needs "rpId", "rpName" and "origin"');
		expect(() => makeDriver({ origin: [] })).toThrow('The passkey driver needs "rpId", "rpName" and "origin"');

		expect(() => makeDriver({ updateCounter: undefined as never })).toThrow(
			'The passkey driver needs a "updateCounter" function',
		);

		expect(defaultExport).toBe(AuthDriverPasskey);
	});
});

describe('begin', () => {
	test('Hands out request options for any key of the site and keeps their challenge', async () => {
		vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: 'ch-1', rpId: 'example.com' } as never);

		// 1. No keys listed and user verification preferred by default
		await expect(makeDriver().driver.begin()).resolves.toStrictEqual({
			options: { challenge: 'ch-1', rpId: 'example.com' },
			state: { challenge: 'ch-1' },
		});

		expect(generateAuthenticationOptions).toHaveBeenCalledWith({ rpID: 'example.com', userVerification: 'preferred' });
	});
});

describe('complete', () => {
	test('Signs the key’s account in and stores the new counter', async () => {
		vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
			verified: true,
			authenticationInfo: { newCounter: 6 },
		} as never);

		const { driver, updateCounter } = makeDriver({ userVerification: 'required' });

		// 1. The identity is the key's account
		await expect(driver.complete({ response: RESPONSE }, { challenge: 'ch-1' })).resolves.toStrictEqual({
			provider: 'passkey',
			subject: 'user-1',
		});

		// 2. The library got the challenge, the relying party and the stored key as bytes
		expect(verifyAuthenticationResponse).toHaveBeenCalledWith({
			response: RESPONSE,
			expectedChallenge: 'ch-1',
			expectedOrigin: 'https://example.com',
			expectedRPID: 'example.com',
			credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 5, transports: ['internal'] },
			requireUserVerification: true,
		});

		expect(updateCounter).toHaveBeenCalledWith('cred-1', 6);
	});

	test('Refuses an answer without the challenge, for an unknown key, or that fails verification', async () => {
		const { driver, updateCounter } = makeDriver();

		// 1. No cookie came back: nothing to check the answer against
		await expect(driver.complete({ response: RESPONSE }, undefined)).rejects.toBeInstanceOf(AuthInvalidTokenError);

		// 2. A key nobody stored, or no answer at all
		await expect(driver.complete({ response: { id: 'other' } }, { challenge: 'ch-1' })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		await expect(driver.complete({}, { challenge: 'ch-1' })).rejects.toBeInstanceOf(InvalidCredentialsError);

		// 3. The library says no, or throws on a malformed answer
		vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false } as never);

		await expect(driver.complete({ response: RESPONSE }, { challenge: 'ch-1' })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(new Error('bad signature'));

		await expect(driver.complete({ response: RESPONSE }, { challenge: 'ch-1' })).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		expect(updateCounter).not.toHaveBeenCalled();
	});
});

describe('registration', () => {
	test('Asks for a discoverable key for the account, excluding the stored ones', async () => {
		vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: 'reg-1' } as never);

		// 1. The account id travels as bytes, the display name falls back to the user name
		await makeDriver().driver.registrationOptions({ userId: 'user-1', userName: 'a@example.com', exclude: [KEY] });

		expect(generateRegistrationOptions).toHaveBeenCalledWith({
			rpName: 'Example',
			rpID: 'example.com',
			userName: 'a@example.com',
			userDisplayName: 'a@example.com',
			userID: new TextEncoder().encode('user-1'),
			excludeCredentials: [{ id: 'cred-1', transports: ['internal'] }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		});
	});

	test('Turns a verified new key into the record to store, and refuses one that is not', async () => {
		vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
			verified: true,
			registrationInfo: {
				credential: { id: 'cred-2', publicKey: new Uint8Array([9, 9]), counter: 0, transports: ['hybrid'] },
				credentialDeviceType: 'multiDevice',
				credentialBackedUp: true,
			},
		} as never);

		const { driver } = makeDriver();

		// 1. The public key as base64url text, with the account the options were made for
		await expect(driver.verifyRegistration(RESPONSE, 'reg-1', 'user-1')).resolves.toStrictEqual({
			id: 'cred-2',
			userId: 'user-1',
			publicKey: Buffer.from([9, 9]).toString('base64url'),
			counter: 0,
			transports: ['hybrid'],
			deviceType: 'multiDevice',
			backedUp: true,
		});

		// 2. A refused or malformed answer is the same refusal
		vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({ verified: false } as never);

		await expect(driver.verifyRegistration(RESPONSE, 'reg-1', 'user-1')).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);

		vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(new Error('bad attestation'));

		await expect(driver.verifyRegistration(RESPONSE, 'reg-1', 'user-1')).rejects.toBeInstanceOf(
			InvalidCredentialsError,
		);
	});
});
