/**
 * Tests of `auth/mfa/verify-totp`.
 *
 * The limiter is the real local one of `@novastarter/memory`.
 */
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { decodeBase32 } from '../utils/index.js';
import { enrollTotp } from './enroll-totp.js';
import { hotp, TOTP_PERIOD, totpStep } from './totp.js';
import { isTotpCode, verifyTotp } from './verify-totp.js';

/**
 * The frozen clock every test runs at, in the middle of a time step.
 */
const NOW = Date.UTC(2026, 0, 1) + 15_000;

/**
 * An encryption key long enough to be accepted.
 */
const KEY = 'test-mfa-encryption-key-of-32-characters';

/**
 * The code an authenticator app would show for a secret at a step.
 *
 * @param secret - The base32 secret from the enrolment.
 * @param step - The time step; the current one unless given.
 * @returns The code.
 */
const codeFor = (secret: string, step: number = totpStep(Date.now())): string => {
	// 1. What the app computes, from the same secret and clock
	return hotp(decodeBase32(secret), step);
};

/**
 * A code of six digits that is none of the codes accepted around now for a secret.
 *
 * @param secret - The base32 secret from the enrolment.
 * @returns The wrong code.
 */
const wrongCodeFor = (secret: string): string => {
	// 1. Counted up from zero until it misses every step of the window, so the test never hits a right code by chance
	const current = totpStep(Date.now());
	const accepted = [current - 1, current, current + 1].map((step) => codeFor(secret, step));
	let code = 0;

	while (accepted.includes(String(code).padStart(6, '0'))) {
		code++;
	}

	return String(code).padStart(6, '0');
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('verifyTotp', () => {
	test('Accepts the current code and returns its step, once the step advanced', async () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });
		const advance = vi.fn(async () => true);

		// 1. The step handed to `advance` is the one returned
		const step = await verifyTotp({ userId: 'user-1', encryptedSecret, code: ` ${codeFor(secret)} `, advance });

		expect(step).toBe(totpStep(NOW));
		expect(advance).toHaveBeenCalledWith(totpStep(NOW));
	});

	test('Accepts the code of the neighbouring step, for a drifting clock', async () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });

		// 1. The previous step's code still works within the window
		const previous = totpStep(NOW) - 1;

		await expect(
			verifyTotp({ userId: 'user-1', encryptedSecret, code: codeFor(secret, previous), advance: async () => true }),
		).resolves.toBe(previous);

		// 2. Two steps back is outside it
		vi.setSystemTime(NOW + 2 * TOTP_PERIOD * 1000);

		await expect(
			verifyTotp({ userId: 'user-1', encryptedSecret, code: codeFor(secret, previous), advance: async () => true }),
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
	});

	test('Refuses a right code whose step did not advance', async () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });

		// 1. The step was used already: a code seen over a shoulder is useless a moment later
		await expect(
			verifyTotp({ userId: 'user-1', encryptedSecret, code: codeFor(secret), advance: async () => false }),
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
	});

	test('Refuses a wrong code without asking to advance', async () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });
		const advance = vi.fn(async () => true);

		// 1. No step matched, so nothing is recorded
		await expect(
			verifyTotp({ userId: 'user-1', encryptedSecret, code: wrongCodeFor(secret), advance }),
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

		expect(advance).not.toHaveBeenCalled();
	});

	test('Charges the mfa limiter per user on every attempt and clears it on success', async () => {
		const mfa = new LimiterDriverLocal({ points: 2, duration: 60 });

		useAuth().registerSettings({ mfa: { encryptionKey: KEY }, limiters: { mfa } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });

		/**
		 * Try a code for `user-1`, the step always advancing, so only the code and the limiter decide.
		 *
		 * @param code - The code to try.
		 * @returns The accepted step.
		 */
		const attempt = (code: string): Promise<number> => {
			// 1. Same user every time, so every attempt draws on one budget
			return verifyTotp({ userId: 'user-1', encryptedSecret, code, advance: async () => true });
		};

		// 1. A miss, then a right code, which clears the count
		await expect(attempt(wrongCodeFor(secret))).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(codeFor(secret))).resolves.toBe(totpStep(NOW));

		// 2. The full budget of two misses is there again, then the limiter refuses even a right code
		await expect(attempt(wrongCodeFor(secret))).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(wrongCodeFor(secret))).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect(attempt(codeFor(secret))).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });

		// 3. Another user has a budget of its own
		await expect(
			verifyTotp({ userId: 'user-2', encryptedSecret, code: codeFor(secret), advance: async () => true }),
		).resolves.toBe(totpStep(NOW));
	});

	test('Refuses to run without a usable encryption key', async () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });

		// 1. The key gone from the settings is a configuration error, not a wrong code
		useAuth().registerSettings({});

		await expect(
			verifyTotp({ userId: 'user-1', encryptedSecret, code: codeFor(secret), advance: async () => true }),
		).rejects.toThrow('The "mfa.encryptionKey" auth setting must be at least 32 characters of random data');
	});
});

describe('isTotpCode', () => {
	test('Tells six digits from a recovery code', () => {
		// 1. Six digits, surrounding spaces allowed
		expect(isTotpCode('123456')).toBe(true);
		expect(isTotpCode(' 123456\n')).toBe(true);

		// 2. Anything else goes to the recovery codes
		expect(isTotpCode('12345')).toBe(false);
		expect(isTotpCode('1234567')).toBe(false);
		expect(isTotpCode('12 3456')).toBe(false);
		expect(isTotpCode('abcde-fghij')).toBe(false);
	});
});
