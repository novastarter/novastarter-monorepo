import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The header a Lemon Squeezy webhook signs with: the hex HMAC-SHA256 of the raw body under the signing secret.
 *
 * @defaultValue `x-signature`
 */
export const SIGNATURE_HEADER = 'x-signature';

/**
 * Whether a webhook body was signed with the secret.
 *
 * Compared in constant time, so the check leaks nothing about how much of a guessed signature was right.
 *
 * @param rawBody - The body byte for byte.
 * @param signature - The `X-Signature` header.
 * @param secret - The signing secret entered when the webhook was created.
 * @returns `true` for a body the secret signed.
 */
export const verifySignature = (rawBody: string, signature: string, secret: string): boolean => {
	// Both sides are compared as the bytes of their hex text; a signature of another length cannot match and must not
	// throw.
	const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
	const given = Buffer.from(signature, 'utf8');

	return expected.length === given.length && timingSafeEqual(expected, given);
};
