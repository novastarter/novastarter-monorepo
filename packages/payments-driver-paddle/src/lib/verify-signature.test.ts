/**
 * Tests of `verify-signature`: the `ts=…;h1=…` header Paddle signs with, read and verified the way the SDK's webhook
 * validator verifies it, but with a constant-time digest comparison.
 */
import { createHmac } from 'node:crypto';
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { MAX_VALID_TIME_DIFFERENCE, signaturePartsOf, verifySignature } from './verify-signature.js';

/** The secret the bodies are signed with. */
const WEBHOOK_SECRET = 'pdl_ntfset_test_secret';

/**
 * The `paddle-signature` header for a body: `ts=<now>;h1=<hex hmac-sha256 of "ts:body">`, the way Paddle signs.
 *
 * @param body - The body text.
 * @param secret - The signing secret; the right one unless given.
 * @param ts - The timestamp; now unless given.
 * @returns The header value.
 */
const sign = (body: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): string =>
	`ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

describe('signaturePartsOf', () => {
	test('Reads both parts in any order and refuses a header missing one', () => {
		const body = '{"a":1}';
		const ts = Math.floor(Date.now() / 1000);
		const h1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}:${body}`).digest('hex');

		// 1. Both orders read the same way the SDK's validator reads them
		expect(signaturePartsOf(`ts=${ts};h1=${h1}`)).toStrictEqual({ ts, h1 });
		expect(signaturePartsOf(`h1=${h1};ts=${ts}`)).toStrictEqual({ ts, h1 });

		// 2. A header without a timestamp or without a digest is malformed: a payload problem, not a credentials one;
		//    a timestamp that is not an integer is as malformed — its replay window would compare against `NaN`
		expect(() => signaturePartsOf(`h1=${h1}`)).toThrow(InvalidPayloadError);
		expect(() => signaturePartsOf(`ts=${ts}`)).toThrow(InvalidPayloadError);
		expect(() => signaturePartsOf('garbage')).toThrow(InvalidPayloadError);
		expect(() => signaturePartsOf(`ts=abc;h1=${h1}`)).toThrow(InvalidPayloadError);
	});
});

describe('verifySignature', () => {
	test('Accepts the digest the secret signed within the window, refuses anything else without throwing', () => {
		const body = '{"a":1}';

		// 1. The digest Paddle would send is the one accepted
		expect(verifySignature(body, signaturePartsOf(sign(body)), WEBHOOK_SECRET)).toBe(true);

		// 2. Another secret's digest has the right length and still fails the constant-time comparison
		expect(verifySignature(body, signaturePartsOf(sign(body, 'other')), WEBHOOK_SECRET)).toBe(false);

		// 3. A digest of another length cannot match; `timingSafeEqual` would throw on it, the check must not
		expect(
			verifySignature(body, signaturePartsOf(`ts=${Math.floor(Date.now() / 1000)};h1=short`), WEBHOOK_SECRET),
		).toBe(false);
	});

	test('Reproduces the SDK’s signed payload and replay window exactly', () => {
		const body = '{"a":1}';
		const ts = Math.floor(Date.now() / 1000);

		// 1. The payload carries the integer timestamp: a digest signed over the zero-padded text is not the one the
		//    SDK computes, so it is refused here as well
		const padded = `0${ts}`;
		const paddedDigest = createHmac('sha256', WEBHOOK_SECRET).update(`${padded}:${body}`).digest('hex');

		expect(verifySignature(body, signaturePartsOf(`ts=${padded};h1=${paddedDigest}`), WEBHOOK_SECRET)).toBe(false);

		// 2. A timestamp inside the window is fresh; one older than the window is stale, a future one is accepted the
		//    way the SDK accepts it
		expect(
			verifySignature(
				body,
				signaturePartsOf(sign(body, WEBHOOK_SECRET, ts - MAX_VALID_TIME_DIFFERENCE - 1)),
				WEBHOOK_SECRET,
			),
		).toBe(false);

		expect(verifySignature(body, signaturePartsOf(sign(body, WEBHOOK_SECRET, ts + 60)), WEBHOOK_SECRET)).toBe(true);
	});
});
