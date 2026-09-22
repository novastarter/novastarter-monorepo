/**
 * Integration tests of `auth/mfa` on PGlite in memory, migrated with the app's `drizzle/` folder. No service is
 * needed, so the suite always runs.
 */
import { createHmac } from 'node:crypto';
import { TOTP_DIGITS, TOTP_PERIOD } from '@novastarter/auth';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDb } from '../db';
import { authMfa, authRecoveryCodes } from '../db/schema';
import {
	confirmTotpEnrolment,
	countRecoveryCodes,
	disableMfa,
	hasMfa,
	regenerateRecoveryCodes,
	startTotpEnrolment,
	verifySecondFactor,
} from './mfa';
import { bootTestDatabase, clearAuthTables, closeTestDatabase } from './test-database';

/**
 * The frozen clock the tests start at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * One TOTP period, in milliseconds.
 */
const PERIOD = TOTP_PERIOD * 1000;

/**
 * The error a wrong second factor comes as.
 */
const WRONG = { code: 'INVALID_CREDENTIALS' };

/**
 * The error a request in the wrong enrolment state comes as.
 */
const REFUSED = { code: 'INVALID_PAYLOAD' };

/**
 * Decode an RFC 4648 base32 secret, the way an authenticator app reads the one the enrolment shows.
 *
 * @param text - The secret, base32.
 * @returns Its bytes.
 */
const decodeBase32 = (text: string): Buffer => {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;

	// 1. Five bits per character in, a byte out whenever eight have gathered; the rest is padding
	for (const char of text.toUpperCase()) {
		value = (value << 5) | alphabet.indexOf(char);
		bits += 5;

		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}

	return Buffer.from(bytes);
};

/**
 * The TOTP code an authenticator app shows for a secret at the current (faked) time, per RFC 6238.
 *
 * Computed here rather than through the package, so the test checks the module against the standard, not against
 * the code it runs.
 *
 * @param secret - The secret, base32, as the enrolment returned it.
 * @returns The code.
 */
const totp = (secret: string): string => {
	// 1. The time step as an 8-byte big-endian counter, HMAC-SHA1'd with the secret
	const counter = Buffer.alloc(8);

	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / PERIOD)));

	const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();

	// 2. Dynamic truncation to the code's digits
	const offset = (digest[digest.length - 1] ?? 0) & 0x0f;

	return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
};

/**
 * Enrol a user and confirm the enrolment with the current code, as the enrolment screen does.
 *
 * @param userId - The user.
 * @returns The secret and the recovery codes.
 */
const enrol = async (userId: string): Promise<{ secret: string; codes: string[] }> => {
	// 1. The code of the current step confirms; the clock then moves a period on, so the next code is a new one
	const { secret } = await startTotpEnrolment(userId, 'ada@example.com');
	const codes = await confirmTotpEnrolment(userId, totp(secret));

	vi.setSystemTime(Date.now() + PERIOD);

	return { secret, codes };
};

describe('auth MFA on PGlite', { timeout: 30_000 }, () => {
	beforeAll(bootTestDatabase, 60_000);

	afterAll(closeTestDatabase);

	beforeEach(() => {
		// 1. Only `Date` is faked: PGlite keeps its real timers
		vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	});

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Starts an enrolment stored encrypted and unconfirmed, and replaces a pending one', async () => {
		const first = await startTotpEnrolment('1', 'ada@example.com');

		// 1. The URI names the issuer and the account; the table holds the secret encrypted, from step 0
		expect(first.uri).toMatch(/^otpauth:\/\/totp\/Test%3Aada%40example\.com\?/);

		const [row] = await useDb().select().from(authMfa);

		expect(row).toMatchObject({ userId: '1', confirmed: false, lastStep: 0 });
		expect(row?.secret).not.toContain(first.secret);
		expect(await hasMfa('1')).toBe(false);

		// 2. A second start replaces the pending secret
		const second = await startTotpEnrolment('1', 'ada@example.com');

		await expect(confirmTotpEnrolment('1', totp(first.secret))).rejects.toMatchObject(WRONG);
		await expect(confirmTotpEnrolment('1', totp(second.secret))).resolves.toHaveLength(10);
	});

	test('Confirms with a code from the app and hands out recovery codes', async () => {
		const { codes } = await enrol('1');

		// 1. TOTP is on, with ten stored codes
		expect(await hasMfa('1')).toBe(true);
		expect(codes).toHaveLength(10);
		expect(await countRecoveryCodes('1')).toBe(10);
	});

	test('Refuses to confirm without a pending enrolment, or twice', async () => {
		await expect(confirmTotpEnrolment('1', '123456')).rejects.toMatchObject(REFUSED);

		// 1. Confirmed once, there is nothing pending any more
		const { secret } = await enrol('1');

		await expect(confirmTotpEnrolment('1', totp(secret))).rejects.toMatchObject(REFUSED);
	});

	test('Refuses a new enrolment while TOTP is confirmed', async () => {
		await enrol('1');

		// 1. A stolen session must not swap the second factor
		await expect(startTotpEnrolment('1', 'thief@example.com')).rejects.toMatchObject(REFUSED);
		expect(await hasMfa('1')).toBe(true);
	});

	test('Accepts a TOTP code once and never an older one', async () => {
		const { secret } = await enrol('1');
		const code = totp(secret);

		// 1. Accepted once; the same code again is a replay
		expect(await verifySecondFactor('1', code)).toBe('totp');
		await expect(verifySecondFactor('1', code)).rejects.toMatchObject(WRONG);

		// 2. The confirmation's code, a step older, is refused as well
		vi.setSystemTime(Date.now() - PERIOD);
		await expect(verifySecondFactor('1', totp(secret))).rejects.toMatchObject(WRONG);
	});

	test('Lets exactly one of two concurrent uses of the same TOTP code win', async () => {
		const { secret } = await enrol('1');
		const code = totp(secret);

		// 1. The conditional step update hands the step to one request only
		const outcomes = await Promise.allSettled([verifySecondFactor('1', code), verifySecondFactor('1', code)]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
	});

	test('Spends a recovery code once, in any case and with or without the dash', async () => {
		const { codes } = await enrol('1');
		const [code] = codes;

		if (!code) {
			throw new Error('the enrolment must hand out codes');
		}

		// 1. Typed upper case without the dash, still the same code
		expect(await verifySecondFactor('1', code.replace('-', '').toUpperCase())).toBe('recovery');
		expect(await countRecoveryCodes('1')).toBe(9);

		// 2. Spent, it is gone
		await expect(verifySecondFactor('1', code)).rejects.toMatchObject(WRONG);
	});

	test('Lets exactly one of two concurrent uses of the same recovery code win', async () => {
		const { codes } = await enrol('1');
		const code = codes[0] ?? '';

		// 1. The atomic delete hands the code to one request only
		const outcomes = await Promise.allSettled([verifySecondFactor('1', code), verifySecondFactor('1', code)]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(await countRecoveryCodes('1')).toBe(9);
	});

	test('Refuses a second factor without a confirmed enrolment, and a recovery code of another user', async () => {
		const { secret } = await startTotpEnrolment('1', 'ada@example.com');

		// 1. A pending enrolment is no second factor
		await expect(verifySecondFactor('1', totp(secret))).rejects.toMatchObject(WRONG);

		// 2. A code belongs to its user alone
		await confirmTotpEnrolment('1', totp(secret));

		const other = await enrol('2');

		await expect(verifySecondFactor('1', other.codes[0] ?? '')).rejects.toMatchObject(WRONG);
	});

	test('Regenerates recovery codes, voiding the old set', async () => {
		await expect(regenerateRecoveryCodes('1')).rejects.toMatchObject(REFUSED);

		// 1. The new set replaces the old one whole
		const { codes } = await enrol('1');
		const fresh = await regenerateRecoveryCodes('1');

		expect(fresh).toHaveLength(10);
		expect(await countRecoveryCodes('1')).toBe(10);
		await expect(verifySecondFactor('1', codes[0] ?? '')).rejects.toMatchObject(WRONG);
		expect(await verifySecondFactor('1', fresh[0] ?? '')).toBe('recovery');
	});

	test('Disables TOTP and drops the recovery codes', async () => {
		await enrol('1');
		await enrol('2');
		await disableMfa('1');

		// 1. Nothing of the user is left; another user keeps theirs
		expect(await hasMfa('1')).toBe(false);
		expect(await countRecoveryCodes('1')).toBe(0);
		expect(await useDb().select().from(authRecoveryCodes).where(eq(authRecoveryCodes.userId, '2'))).toHaveLength(10);

		// 2. A new enrolment is allowed again
		await expect(startTotpEnrolment('1', 'ada@example.com')).resolves.toHaveProperty('secret');
	});
});
