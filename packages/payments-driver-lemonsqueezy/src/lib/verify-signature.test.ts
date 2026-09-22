/**
 * Tests of `verify-signature`: the hex HMAC-SHA256 of the body under the signing secret, the way Lemon Squeezy signs
 * a delivery, compared in constant time.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { verifySignature } from './verify-signature.js';

/** The secret the bodies are signed with. */
const WEBHOOK_SECRET = 'lemon-signing-secret';

/**
 * The `X-Signature` of a body.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @returns The hex digest.
 */
const sign = (body: string, secret = WEBHOOK_SECRET): string => createHmac('sha256', secret).update(body).digest('hex');

describe('verifySignature', () => {
	test('Accepts the body’s digest under the secret, refuses anything else without throwing', () => {
		const body = '{"a":1}';

		// 1. The digest Lemon Squeezy would send is the one accepted
		expect(verifySignature(body, sign(body), WEBHOOK_SECRET)).toBe(true);

		// 2. Another secret's digest has the right length and still fails the constant-time comparison
		expect(verifySignature(body, sign(body, 'other'), WEBHOOK_SECRET)).toBe(false);

		// 3. A signature of another length cannot match; `timingSafeEqual` would throw on it, the check must not
		expect(verifySignature(body, 'short', WEBHOOK_SECRET)).toBe(false);
	});
});
