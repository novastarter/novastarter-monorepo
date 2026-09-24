import { createPrivateKey } from 'node:crypto';
import { InvalidConfigError } from '@novastarter/errors';

/**
 * Check an APNs auth key: a PEM private key on the P-256 curve, which ES256 — the only algorithm APNs takes —
 * signs with.
 *
 * @param pem - The key as given.
 * @throws InvalidConfigError when the PEM does not parse or is not a P-256 EC key.
 */
export const assertSigningKey = (pem: string): void => {
	let key;

	// A key that does not parse is reported by the option's name, the parser's complaint as the cause
	try {
		key = createPrivateKey(pem);
	} catch (error) {
		throw new InvalidConfigError(
			{ reason: 'The apns push driver needs a PEM private key as "signingKey"' },
			{ cause: error },
		);
	}

	// An RSA key or another curve would produce a JWT APNs answers `InvalidProviderToken` to
	if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
		throw new InvalidConfigError({
			reason: 'The apns push driver needs a P-256 EC key (an APNs auth key, .p8) as "signingKey"',
		});
	}
};
