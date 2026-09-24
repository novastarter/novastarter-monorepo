import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidPayloadError } from '@novastarter/errors';

/**
 * How long after its timestamp a delivery stays valid: the window the SDK's webhook validator enforces, reproduced
 * here so the whole verification happens before the SDK parses the body. A timestamp newer than the window is
 * accepted — the SDK does not guard against the clock running ahead.
 *
 * @defaultValue 5 seconds
 */
export const MAX_VALID_TIME_DIFFERENCE = 5;

/**
 * The parts of a `paddle-signature` header: the unix timestamp and the hex digest.
 */
export interface SignatureParts {
	/** The unix seconds of the signature, as the integer the signed payload carries. */
	ts: number;
	/** The hex HMAC-SHA256 of `"ts:body"`. */
	h1: string;
}

/**
 * Split a `paddle-signature` header into its timestamp and digest, the way the SDK's webhook validator reads it.
 *
 * Both parts are required in any order; the timestamp is parsed to an integer, because the signed payload carries
 * the integer, not the text — `"0169875"` and `"169875"` sign the same payload.
 *
 * @param signature - The header value.
 * @returns The timestamp and the digest.
 * @throws InvalidPayloadError when the header names no timestamp or no digest, or when the timestamp is not an
 * integer — a non-integer would make the replay-window check compare against `NaN` and accept any age.
 */
export const signaturePartsOf = (signature: string): SignatureParts => {
	// The header is `ts=…;h1=…` — both parts are required, in any order, a part with an empty value counting as
	// absent, the way the SDK's validator reads it
	let ts = '';
	let h1 = '';

	for (const part of signature.split(';')) {
		const [key, value] = part.split('=');

		if (!value) continue;

		if (key === 'ts') ts = value;
		else if (key === 'h1') h1 = value;
	}

	// Without both parts the header is malformed: a payload problem the sender fixes, not a credentials problem
	if (!ts || !h1) {
		throw new InvalidPayloadError({ reason: 'The paddle-signature header carries no timestamp or digest' });
	}

	// The timestamp is used the way the SDK uses it: parsed to an integer that is stringified back into the
	// signed payload — a non-integer would parse to `NaN`, the digest would be computed over `"NaN:…"` and the
	// replay window over `NaN`, silently accepting a delivery of any age
	const timestamp = parseInt(ts, 10);

	if (!Number.isInteger(timestamp)) {
		throw new InvalidPayloadError({ reason: 'The paddle-signature header carries a timestamp that is not an integer' });
	}

	return { ts: timestamp, h1 };
};

/**
 * Whether a webhook body was signed with the secret within the SDK's replay window, the way Paddle signs: the hex
 * HMAC-SHA256 of `"ts:body"` under the secret, compared in constant time.
 *
 * The comparison leaks nothing about how much of a guessed signature was right, unlike the plain `===` the SDK
 * stops at the first differing byte with. A timestamp older than {@link MAX_VALID_TIME_DIFFERENCE} seconds is
 * refused; a future one is accepted, so a server clock more than the window behind Paddle's rejects valid
 * deliveries.
 *
 * @param rawBody - The body byte for byte.
 * @param parts - What {@link signaturePartsOf} read from the header.
 * @param secret - The notification destination's secret.
 * @returns `true` for a body the secret signed within the window.
 */
export const verifySignature = (rawBody: string, parts: SignatureParts, secret: string): boolean => {
	// The signed payload is the integer timestamp, a colon, then the body — reproduced exactly, so a digest the
	// SDK would accept is accepted here too
	const expected = createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest('hex');

	// Both sides as the bytes of their hex text, compared in constant time; a digest of another length cannot
	// match and must not throw
	const expectedBytes = Buffer.from(expected, 'utf8');
	const givenBytes = Buffer.from(parts.h1, 'utf8');
	const matches = expectedBytes.length === givenBytes.length && timingSafeEqual(expectedBytes, givenBytes);

	// The SDK's replay window: a timestamp older than five seconds is stale, a future one is not refused
	const stale = Date.now() > (parts.ts + MAX_VALID_TIME_DIFFERENCE) * 1000;

	return matches && !stale;
};
