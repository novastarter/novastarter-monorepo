/**
 * Tests of `auth/mfa/totp`.
 */
import { describe, expect, test } from 'vitest';
import { hotp, matchTotp, otpauthUri, TOTP_DIGITS, TOTP_PERIOD, TOTP_WINDOW, totpStep } from './totp.js';

/**
 * The SHA-1 secret of RFC 6238 appendix B: the ASCII string "12345678901234567890".
 */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

/**
 * RFC 6238 appendix B SHA-1 vectors — time in seconds, code — cut to the last six of the eight published digits, since
 * the truncation is the same and only the final modulus differs.
 */
const RFC_VECTORS: [number, string][] = [
	[59, '287082'],
	[1111111109, '081804'],
	[1111111111, '050471'],
	[1234567890, '005924'],
	[2000000000, '279037'],
	[20000000000, '353130'],
];

describe('constants', () => {
	test('Match what authenticator apps use', () => {
		// 1. Six digits every 30 seconds, one step of slack either way
		expect(TOTP_DIGITS).toBe(6);
		expect(TOTP_PERIOD).toBe(30);
		expect(TOTP_WINDOW).toBe(1);
	});
});

describe('totpStep', () => {
	test('Counts whole periods since the epoch', () => {
		// 1. Milliseconds in, floor of the 30-second periods out
		expect(totpStep(0)).toBe(0);
		expect(totpStep(29_999)).toBe(0);
		expect(totpStep(30_000)).toBe(1);
		expect(totpStep(59_000)).toBe(1);
	});
});

describe('hotp', () => {
	test.each(RFC_VECTORS)('Gives the RFC 6238 code at %i seconds: %s', (seconds, code) => {
		// 1. TOTP is HOTP of the time step; the vectors pin the counter encoding, the HMAC and the truncation
		expect(hotp(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
	});

	test('Gives the RFC 4226 HOTP vectors for the first counters', () => {
		// 1. RFC 4226 appendix D, same secret: the zero padding of `005924`-like codes is covered by these too
		expect(hotp(RFC_SECRET, 0)).toBe('755224');
		expect(hotp(RFC_SECRET, 1)).toBe('287082');
		expect(hotp(RFC_SECRET, 9)).toBe('520489');
	});
});

describe('matchTotp', () => {
	test('Returns the step of a code within one step of now, and null outside the window', () => {
		const now = 1111111111 * 1000;
		const current = totpStep(now);

		// 1. The current code, the previous one and the next one all match, each to its own step
		expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, current), now)).toBe(current);
		expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, current - 1), now)).toBe(current - 1);
		expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, current + 1), now)).toBe(current + 1);

		// 2. Two steps away is outside the window
		expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, current - 2), now)).toBeNull();
		expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, current + 2), now)).toBeNull();
	});

	test('Refuses a code of the wrong length or a wrong secret', () => {
		const now = 59 * 1000;

		// 1. The eight-digit form of the vector is not the six-digit code
		expect(matchTotp(RFC_SECRET, '94287082', now)).toBeNull();

		// 2. The right code for another secret does not match
		expect(matchTotp(Buffer.from('another secret here!'), '287082', now)).toBeNull();
	});
});

describe('otpauthUri', () => {
	test('Puts the issuer in the label and the parameters, with the algorithm, digits and period', () => {
		const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'Acme Inc', 'user@example.com'));

		// 1. The label is `issuer:account`, percent-encoded as one path segment
		expect(uri.protocol).toBe('otpauth:');
		expect(uri.href.startsWith('otpauth://totp/Acme%20Inc%3Auser%40example.com?')).toBe(true);

		// 2. Every parameter an app reads, the issuer repeated for the apps that ignore the label
		expect(Object.fromEntries(uri.searchParams)).toStrictEqual({
			secret: 'JBSWY3DPEHPK3PXP',
			issuer: 'Acme Inc',
			algorithm: 'SHA1',
			digits: '6',
			period: '30',
		});
	});
});
