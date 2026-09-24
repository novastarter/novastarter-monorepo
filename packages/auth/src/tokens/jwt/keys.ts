import { InvalidConfigError } from '@novastarter/errors';
import { type CryptoKey, importPKCS8, importSPKI } from 'jose';
import { requireSecret } from '../../lib/require-secret.js';
import { authSettings } from '../../lib/settings-access.js';
import type { AuthJwtSettings } from '../../lib/settings.js';

/**
 * The keys and algorithm the JWTs of the process are signed and verified with.
 *
 * @internal
 */
export interface JwtKeys {
	/** The `alg` header, fixed: a token naming another algorithm is refused. */
	algorithm: 'HS256' | 'ES256' | 'EdDSA';
	/** The key that signs. */
	signKey: CryptoKey | Uint8Array;
	/** The key that verifies. */
	verifyKey: CryptoKey | Uint8Array;
	/** The settings they came from, for the claims. */
	settings: AuthJwtSettings;
}

/**
 * Imported keys by the settings object they came from, so the PEM is parsed once per registration rather than on
 * every token.
 *
 * @internal
 */
const cache = new WeakMap<AuthJwtSettings, Promise<JwtKeys>>();

/**
 * The keys of the registered JWT settings, imported on first use.
 *
 * @returns The keys and the algorithm.
 * @throws InvalidConfigError when the settings have no JWT section, a secret shorter than `MIN_SECRET_LENGTH`, or an
 * incomplete key pair.
 * @internal
 */
export const jwtKeys = (): Promise<JwtKeys> => {
	// JWTs need a secret; a missing one is a configuration error named here rather than a failed signature later
	const settings = authSettings().jwt;

	if (!settings) {
		throw new InvalidConfigError({ reason: 'JWT tokens need the "jwt" auth settings' });
	}

	// One import per settings object: a new `registerSettings` brings a new object, so rotated keys are picked up
	let keys = cache.get(settings);

	if (!keys) {
		keys = importKeys(settings);
		cache.set(settings, keys);

		// A failed import is not cached, so fixing the settings does not need a restart to be seen
		keys.catch(() => cache.delete(settings));
	}

	return keys;
};

/**
 * Import the keys the settings describe.
 *
 * @param settings - The JWT settings.
 * @returns The keys and the algorithm.
 * @throws InvalidConfigError for a short secret or an incomplete key pair.
 * @internal
 */
const importKeys = async (settings: AuthJwtSettings): Promise<JwtKeys> => {
	const algorithm = settings.algorithm ?? (settings.secret !== undefined ? 'HS256' : 'ES256');

	// A shared secret signs and verifies alike; a short one could be brute-forced offline from any token
	if (algorithm === 'HS256') {
		const key = new TextEncoder().encode(requireSecret(settings.secret, 'jwt.secret'));

		return { algorithm, signKey: key, verifyKey: key, settings };
	}

	// A key pair: the private half signs, the public half verifies — the half other services can be given
	if (!settings.privateKey || !settings.publicKey) {
		throw new InvalidConfigError({ reason: `The ${algorithm} JWT algorithm needs a "privateKey" and a "publicKey"` });
	}

	return {
		algorithm,
		signKey: await importPKCS8(settings.privateKey, algorithm),
		verifyKey: await importSPKI(settings.publicKey, algorithm),
		settings,
	};
};
