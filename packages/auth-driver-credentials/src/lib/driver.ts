import {
	type AuthDriver,
	type AuthIdentity,
	type Credentials,
	DEFAULT_SCRYPT_PARAMS,
	hashPassword,
	needsRehash,
	type ScryptParams,
	verifyPassword,
} from '@novastarter/auth';
import { InvalidConfigError, InvalidCredentialsError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';

/**
 * What {@link AuthDriverCredentialsConfig.findUser} answers for an account: its id and its stored password hash.
 */
export type CredentialsUser = {
	/** The application's id of the user; becomes the identity's `subject`. */
	id: string;
	/** The hash `hashPassword()` made; `null` for an account without a password, one that only signs in by OAuth. */
	passwordHash: string | null;
};

/**
 * Options accepted by {@link AuthDriverCredentials}.
 */
export type AuthDriverCredentialsConfig = {
	/**
	 * Look an account up by what the person typed as their identifier — an email address, a user name — already
	 * trimmed; any further normalisation, such as lower-casing an email, is the application's.
	 */
	findUser: (identifier: string) => Promise<CredentialsUser | null>;
	/**
	 * Store a fresh hash of the password, called after a sign-in whose stored hash was made with another cost than
	 * `params`. Without it, old hashes keep their cost.
	 */
	onRehash?: ((id: string, hash: string) => Promise<void>) | undefined;
	/** The scrypt cost of new hashes; `DEFAULT_SCRYPT_PARAMS` of `@novastarter/auth` unless given. */
	params?: ScryptParams | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/auth`, so a location naming `credentials` has its
 * options checked against {@link AuthDriverCredentialsConfig}.
 */
declare module '@novastarter/auth' {
	interface AuthDrivers {
		credentials: AuthDriverCredentialsConfig;
	}
}

/**
 * The password the dummy hash is made from; nothing is ever compared against it, only its cost matters.
 *
 * @internal
 */
const DUMMY_PASSWORD = 'novastarter-credentials-dummy-password';

/**
 * Sign-in driver for an identifier and a password checked against the application's own users.
 *
 * The driver only proves who someone is: it looks the account up through `findUser`, checks the password with
 * `verifyPassword()` and answers `{ provider: 'credentials', subject: user.id }`. An unknown account and an account
 * without a password cost the same scrypt run as a wrong password — against a dummy hash of the same cost — so the
 * response time does not tell an attacker which identifiers exist. Rate limits and events are `signIn()`'s.
 *
 * @example
 * ```ts
 * import { useAuth } from '@novastarter/auth';
 * import { AuthDriverCredentials } from '@novastarter/auth-driver-credentials';
 *
 * const auth = useAuth();
 *
 * auth.registerDriver('credentials', AuthDriverCredentials);
 * auth.registerLocation('credentials', {
 * 	driver: 'credentials',
 * 	options: {
 * 		findUser: async (email) => db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) }) ?? null,
 * 		onRehash: async (id, hash) => {
 * 			await db.update(users).set({ passwordHash: hash }).where(eq(users.id, id));
 * 		},
 * 	},
 * });
 * ```
 */
export class AuthDriverCredentials implements AuthDriver {
	/**
	 * Looks an account up by its identifier.
	 *
	 * @internal
	 */
	private readonly findUser: AuthDriverCredentialsConfig['findUser'];

	/**
	 * Stores a fresh hash after a sign-in with an outdated one; absent when the application does not rehash.
	 *
	 * @internal
	 */
	private readonly onRehash: AuthDriverCredentialsConfig['onRehash'];

	/**
	 * The cost new hashes are made with, and the dummy hash too.
	 *
	 * @internal
	 */
	private readonly params: ScryptParams;

	/**
	 * The dummy hash, made on the first sign-in that needs it and kept for the driver's lifetime.
	 *
	 * @internal
	 */
	private dummyHash: Promise<string> | undefined;

	/**
	 * Create a driver on the application's user lookup.
	 *
	 * @param config - The lookup, the rehash callback and the cost.
	 * @throws InvalidConfigError without a `findUser` function.
	 */
	constructor(config: AuthDriverCredentialsConfig) {
		// Checked at construction, so a missing lookup is reported by the option's name rather than at the first
		// sign-in
		if (typeof config.findUser !== 'function') {
			throw new InvalidConfigError({ reason: 'The credentials auth driver needs a "findUser" function' });
		}

		this.findUser = config.findUser;
		this.onRehash = config.onRehash;
		this.params = config.params ?? DEFAULT_SCRYPT_PARAMS;
	}

	/**
	 * Check an identifier and a password against the application's users.
	 *
	 * @param credentials - What the person typed.
	 * @returns The identity: provider `credentials`, the user's id as the subject.
	 * @throws InvalidCredentialsError when the account does not exist, has no password or the password does not match.
	 * @throws InvalidPayloadError for an empty password or one longer than `MAX_PASSWORD_LENGTH`.
	 * @throws Error when the stored hash is not a scrypt PHC string — a broken record, not a wrong password.
	 */
	async authenticate(credentials: Credentials): Promise<AuthIdentity> {
		// Surrounding spaces are what a form or a password manager adds by accident; anything more is the lookup's. A
		// form body is untyped at runtime, so an identifier that is no string is treated as an unknown account
		const identifier = typeof credentials.identifier === 'string' ? credentials.identifier.trim() : '';
		const user = identifier ? await this.findUser(identifier) : null;

		// The same scrypt run as a real check, against a hash of the same cost, so the time taken does not reveal
		// whether the identifier exists
		if (!user || user.passwordHash === null) {
			await verifyPassword(credentials.password, await this.getDummyHash());

			throw new InvalidCredentialsError();
		}

		// One error for every failure, so the caller cannot tell a wrong password from an unknown account
		if (!(await verifyPassword(credentials.password, user.passwordHash))) {
			throw new InvalidCredentialsError();
		}

		// The password is at hand only now, so this is the moment to bring an old hash up to the current cost
		await this.rehash(user.id, user.passwordHash, credentials.password);

		return { provider: 'credentials', subject: user.id };
	}

	/**
	 * Replace a hash made with another cost than the configured one, when the application takes new hashes.
	 *
	 * A failure is logged and swallowed: the person proved their password, and a storage hiccup must not turn a valid
	 * sign-in into an error — the next sign-in tries again.
	 *
	 * @param id - The user's id.
	 * @param hash - The stored hash that just verified.
	 * @param password - The password that matched it.
	 * @internal
	 */
	private async rehash(id: string, hash: string, password: string): Promise<void> {
		if (!this.onRehash || !needsRehash(hash, this.params)) {
			return;
		}

		// Hashing and storing both run inside the guard, since either one failing leaves the old hash valid anyway
		try {
			await this.onRehash(id, await hashPassword(password, this.params));
		} catch (error) {
			useLogger().warn(toError(error), `Rehashing the password of user "${id}" failed; the old hash stays`);
		}
	}

	/**
	 * The hash unknown accounts are checked against, made once per driver.
	 *
	 * @returns A hash with the configured cost.
	 * @internal
	 */
	private getDummyHash(): Promise<string> {
		// Made lazily, so a process that never sees an unknown account never pays for it, and kept as a promise, so
		// concurrent first calls share one hashing instead of each starting their own
		if (!this.dummyHash) {
			const pending = hashPassword(DUMMY_PASSWORD, this.params);

			// A failed hashing is not cached, so the next sign-in tries again instead of failing for good
			pending.catch(() => {
				if (this.dummyHash === pending) {
					this.dummyHash = undefined;
				}
			});

			this.dummyHash = pending;
		}

		return this.dummyHash;
	}
}
