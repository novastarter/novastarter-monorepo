import { requireSecrets } from '../lib/require-secret.js';
import { authSettings } from '../lib/settings-access.js';

/**
 * The keys TOTP secrets are encrypted with, current first.
 *
 * @returns The `mfa.encryptionKey` of the settings, as a list: the first encrypts, every one decrypts.
 * @throws InvalidConfigError without one, or with one shorter than `MIN_SECRET_LENGTH`: stored in the clear or under a
 * weak key, the secrets would let a database dump sign in as anyone enrolled.
 * @internal
 */
export const mfaKeys = (): string[] => {
	// The same bar as every other secret of the package, old keys kept for rotation included
	return requireSecrets(authSettings().mfa?.encryptionKey, 'mfa.encryptionKey');
};
