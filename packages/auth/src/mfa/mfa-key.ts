import { requireSecret } from '../lib/require-secret.js';
import { authSettings } from '../lib/settings-access.js';

/**
 * The key TOTP secrets are encrypted with.
 *
 * @returns The `mfa.encryptionKey` of the settings.
 * @throws Error without one, or with one shorter than `MIN_SECRET_LENGTH`: stored in the clear or under a weak key,
 * the secrets would let a database dump sign in as anyone enrolled.
 * @internal
 */
export const mfaKey = (): string => {
	// 1. The same bar as every other secret of the package
	return requireSecret(authSettings().mfa?.encryptionKey, 'mfa.encryptionKey');
};
