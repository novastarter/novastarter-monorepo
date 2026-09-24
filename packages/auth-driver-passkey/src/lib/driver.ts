import { type AuthDriver, type AuthIdentity, AuthInvalidTokenError, type ChallengeBegun } from '@novastarter/auth';
import { InvalidConfigError, InvalidCredentialsError } from '@novastarter/errors';
import {
	type AuthenticationResponseJSON,
	generateAuthenticationOptions,
	generateRegistrationOptions,
	type PublicKeyCredentialCreationOptionsJSON,
	type RegistrationResponseJSON,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';

/**
 * A passkey as the application stores it, one row per key: a person may have several, one per device or manager.
 */
export interface PasskeyCredential {
	/** The credential id the browser answers with, base64url; the key of the row. */
	id: string;
	/** The account the key signs in to. */
	userId: string;
	/** The key's COSE public key, base64url — text, so any column type holds it. */
	publicKey: string;
	/** The signature counter; a key that stops counting up may be cloned, so every sign-in stores the new value. */
	counter: number;
	/** How the browser reaches the key — `internal`, `hybrid`, `usb` — as it reported them; a hint for later prompts. */
	transports?: string[] | undefined;
	/** Whether the key is synced between devices (`multiDevice`) or bound to one (`singleDevice`). */
	deviceType?: 'singleDevice' | 'multiDevice' | undefined;
	/** Whether the key is backed up, so losing the device does not lose it. */
	backedUp?: boolean | undefined;
}

/**
 * Options accepted by {@link AuthDriverPasskey}.
 */
export type AuthDriverPasskeyConfig = {
	/** The relying party id: the site's domain, `example.com`, without scheme or port. */
	rpId: string;
	/** The name the browser shows in its passkey prompt: the application's name. */
	rpName: string;
	/** The origin — or origins — the pages asking for a passkey are served from: `https://example.com`. */
	origin: string | string[];
	/** Find a stored passkey by its credential id; `null` when none has it. */
	findCredential: (id: string) => Promise<PasskeyCredential | null>;
	/** Store the signature counter a sign-in ended with. */
	updateCounter: (id: string, counter: number) => Promise<void>;
	/**
	 * Whether the key must check the person — a fingerprint, a PIN — or only their presence; `preferred` unless given,
	 * which asks for it and accepts a key that cannot.
	 */
	userVerification?: 'required' | 'preferred' | undefined;
};

/**
 * What {@link AuthDriverPasskey.registrationOptions} takes: the account a new key is for.
 */
export interface PasskeyRegistrationParams {
	/** The account's id; the key will sign in to it. */
	userId: string;
	/** What the browser shows as the account in its prompt: an email address, a user name. */
	userName: string;
	/** A friendlier name for the prompt; `userName` unless given. */
	userDisplayName?: string | undefined;
	/** The account's keys already stored, so the browser does not register the same authenticator twice. */
	exclude?: Pick<PasskeyCredential, 'id' | 'transports'>[] | undefined;
}

/**
 * Registers the driver's options in the map of `@novastarter/auth`, so a location naming `passkey` has its options
 * checked against {@link AuthDriverPasskeyConfig}.
 */
declare module '@novastarter/auth' {
	interface AuthDrivers {
		passkey: AuthDriverPasskeyConfig;
	}
}

/**
 * Sign-in with a passkey (WebAuthn), the second step of `startChallenge()` / `finishChallenge()`, on
 * `@simplewebauthn/server`.
 *
 * The first step hands the browser request options with a fresh challenge and keeps the challenge in the sealed
 * cookie; the second checks the browser's signed answer against the stored key. No account is named up front: the
 * browser offers the keys it holds for the site (discoverable credentials). The package stores nothing — the keys are
 * the application's, reached through `findCredential` and `updateCounter`; adding a key to an account is
 * `startPasskeyRegistration()` / `finishPasskeyRegistration()`.
 *
 * @example
 * ```ts
 * auth.registerDriver('passkey', AuthDriverPasskey);
 * auth.registerLocation('passkey', {
 * 	driver: 'passkey',
 * 	options: { rpId: 'example.com', rpName: 'Example', origin: 'https://example.com', findCredential, updateCounter },
 * });
 *
 * const { options, cookie } = await startChallenge('passkey');
 * const identity = await finishChallenge('passkey', { input: { response }, cookie });
 * ```
 */
export class AuthDriverPasskey implements AuthDriver {
	/**
	 * The options the driver was built with.
	 *
	 * @internal
	 */
	private readonly config: AuthDriverPasskeyConfig;

	/**
	 * Create the driver from its location options.
	 *
	 * @param config - The relying party and the application's key lookup.
	 * @throws InvalidConfigError when the relying party or a callback is missing.
	 */
	constructor(config: AuthDriverPasskeyConfig) {
		// Checked here, since the options come from a location config typed loosely enough to leave one out
		if (!config.rpId || !config.rpName || !config.origin || config.origin.length === 0) {
			throw new InvalidConfigError({ reason: 'The passkey driver needs "rpId", "rpName" and "origin"' });
		}

		for (const name of ['findCredential', 'updateCounter'] as const) {
			if (typeof config[name] !== 'function') {
				throw new InvalidConfigError({ reason: `The passkey driver needs a "${name}" function` });
			}
		}

		this.config = config;
	}

	/**
	 * Make the request options of a sign-in, with a fresh challenge.
	 *
	 * @returns The options for `navigator.credentials.get()`, and the challenge as state.
	 */
	async begin(): Promise<ChallengeBegun> {
		// No allowed keys listed: the browser offers every key it holds for the site, so nobody types a name first
		const options = await generateAuthenticationOptions({
			rpID: this.config.rpId,
			userVerification: this.config.userVerification ?? 'preferred',
		});

		return { options, state: { challenge: options.challenge } };
	}

	/**
	 * Check the browser's signed answer against the stored key and its challenge.
	 *
	 * @param input - `response`: what `navigator.credentials.get()` resolved with, as JSON.
	 * @param state - The challenge of the first step.
	 * @returns The identity of the key's account.
	 * @throws AuthInvalidTokenError without the challenge: the cookie of the first step did not come back.
	 * @throws InvalidCredentialsError for an unknown key, or an answer that does not check out.
	 */
	async complete(input: Record<string, unknown>, state: Record<string, unknown> | undefined): Promise<AuthIdentity> {
		// The challenge is what makes the answer fresh; without the cookie there is nothing to check it against
		const challenge = state?.['challenge'];

		if (typeof challenge !== 'string') {
			throw new AuthInvalidTokenError();
		}

		const response = input['response'] as AuthenticationResponseJSON | undefined;
		const credential = typeof response?.id === 'string' ? await this.config.findCredential(response.id) : null;

		if (!response || !credential) {
			throw new InvalidCredentialsError();
		}

		// The library throws on a malformed answer, which is a refusal like any other
		let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;

		try {
			verified = await verifyAuthenticationResponse({
				response,
				expectedChallenge: challenge,
				expectedOrigin: this.config.origin,
				expectedRPID: this.config.rpId,
				credential: {
					id: credential.id,
					publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
					counter: credential.counter,
					...(credential.transports ? { transports: credential.transports } : {}),
				},
				requireUserVerification: this.config.userVerification === 'required',
			});
		} catch {
			throw new InvalidCredentialsError();
		}

		if (!verified.verified) {
			throw new InvalidCredentialsError();
		}

		// The new counter is stored before the sign-in completes, so a cloned key replaying an old one is caught next
		await this.config.updateCounter(credential.id, verified.authenticationInfo.newCounter);

		return { provider: 'passkey', subject: credential.userId };
	}

	/**
	 * Make the creation options of a new key for an account, with a fresh challenge.
	 *
	 * @param params - The account, its name for the prompt, and its keys already stored.
	 * @returns The options for `navigator.credentials.create()`; their `challenge` has to come back at
	 * {@link verifyRegistration}.
	 */
	async registrationOptions(params: PasskeyRegistrationParams): Promise<PublicKeyCredentialCreationOptionsJSON> {
		// A discoverable key, so it can sign in without a name typed first; the user handle is bytes, as WebAuthn wants
		// it
		return generateRegistrationOptions({
			rpName: this.config.rpName,
			rpID: this.config.rpId,
			userName: params.userName,
			userDisplayName: params.userDisplayName ?? params.userName,
			userID: new TextEncoder().encode(params.userId),
			excludeCredentials: (params.exclude ?? []).map((key) => ({
				id: key.id,
				...(key.transports ? { transports: key.transports } : {}),
			})),
			authenticatorSelection: {
				residentKey: 'required',
				userVerification: this.config.userVerification ?? 'preferred',
			},
		});
	}

	/**
	 * Check the browser's new key against the challenge of {@link registrationOptions}, and make the record to store.
	 *
	 * @param response - What `navigator.credentials.create()` resolved with, as JSON.
	 * @param challenge - The challenge of the options.
	 * @param userId - The account the options were made for.
	 * @returns The key, for the application to store.
	 * @throws InvalidCredentialsError when the answer does not check out.
	 */
	async verifyRegistration(
		response: RegistrationResponseJSON,
		challenge: string,
		userId: string,
	): Promise<PasskeyCredential> {
		// A malformed answer is a refusal too
		let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;

		try {
			verified = await verifyRegistrationResponse({
				response,
				expectedChallenge: challenge,
				expectedOrigin: this.config.origin,
				expectedRPID: this.config.rpId,
				requireUserVerification: this.config.userVerification === 'required',
			});
		} catch {
			throw new InvalidCredentialsError();
		}

		if (!verified.verified) {
			throw new InvalidCredentialsError();
		}

		// The public key as text, so the application stores the record as it is
		const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;

		return {
			id: credential.id,
			userId,
			publicKey: Buffer.from(credential.publicKey).toString('base64url'),
			counter: credential.counter,
			...(credential.transports ? { transports: credential.transports } : {}),
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
		};
	}
}
