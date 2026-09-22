/**
 * Tests of `config/auth`: providers join only with complete keys, the limiters ride Redis when there is one, and
 * production refuses to boot on the public development secrets.
 */
import type { Redis } from 'ioredis';
import { describe, expect, test } from 'vitest';
import { envSchema } from '../env';
import { authConfig } from './auth';

/**
 * The parsed variables the config reads, from raw overrides over the schema defaults.
 *
 * @param overrides - Raw variables over the defaults.
 * @returns The parsed variables.
 */
const env = (overrides: Record<string, string> = {}) => envSchema.parse({ NODE_ENV: 'test', ...overrides });

/**
 * Thirty-two characters of stand-in secret, the shortest the schema accepts.
 */
const SECRET = 'x'.repeat(32);

/**
 * All three production secrets, set to {@link SECRET}.
 */
const SECRETS = { AUTH_JWT_SECRET: SECRET, AUTH_MFA_ENCRYPTION_KEY: SECRET, AUTH_OAUTH_SECRET: SECRET };

describe('authConfig', () => {
	test('Registers credentials always and each provider only with its complete keys', () => {
		// 1. No keys: credentials alone
		expect(Object.keys(authConfig(env(), { redis: undefined }).providers)).toEqual(['credentials']);

		// 2. Half a Google pair is left out; a full GitHub pair joins
		const config = authConfig(
			env({
				AUTH_GOOGLE_CLIENT_ID: 'google-id',
				AUTH_GITHUB_CLIENT_ID: 'github-id',
				AUTH_GITHUB_CLIENT_SECRET: 'github-secret',
			}),
			{ redis: undefined },
		);

		expect(Object.keys(config.providers).sort()).toEqual(['credentials', 'github']);
	});

	test('Puts the limiters on Redis when there is one', () => {
		// 1. A stand-in client is enough: the config only passes it on
		const redis = {} as Redis;
		const config = authConfig(env(), { redis });

		expect(config.limiters['auth-sign-in']).toEqual({
			driver: 'redis',
			options: { redis, namespace: 'auth-sign-in', points: 10, duration: 900 },
		});

		// 2. Without a server, everything stays in the process
		expect(authConfig(env(), { redis: undefined }).limiters['auth-mfa'].driver).toBe('local');
	});

	test('Uses the development secrets outside production and the configured ones when set', () => {
		// 1. A fresh clone runs without configuration
		const fresh = authConfig(env(), { redis: undefined });

		expect(fresh.settings.jwt?.secret).toMatch(/^development-only/);
		expect(fresh.settings.mfa?.encryptionKey).toMatch(/^development-only/);
		expect(fresh.settings.oauth?.secret).toMatch(/^development-only/);

		// 2. Configured values win
		const config = authConfig(env(SECRETS), { redis: undefined });

		expect(config.settings.jwt?.secret).toBe(SECRET);
		expect(config.settings.mfa?.encryptionKey).toBe(SECRET);
		expect(config.settings.oauth?.secret).toBe(SECRET);
	});

	test('Refuses a secret shorter than 32 characters', () => {
		// 1. The schema stops it before the config sees it
		expect(() => env({ AUTH_OAUTH_SECRET: 'x'.repeat(31) })).toThrow();
	});

	test('Refuses to boot in production without any one of the secrets', () => {
		// 1. The public development values must never sign or encrypt anything in production: each missing one refuses
		const production = (overrides: Record<string, string>) => () =>
			authConfig(env({ NODE_ENV: 'production', ...overrides }), { redis: undefined });

		expect(production({})).toThrowError(/AUTH_JWT_SECRET, AUTH_MFA_ENCRYPTION_KEY and AUTH_OAUTH_SECRET/);

		for (const name of Object.keys(SECRETS)) {
			const partial = Object.fromEntries(Object.entries(SECRETS).filter(([key]) => key !== name));

			expect(production(partial)).toThrowError(/required in production/);
		}

		// 2. All three set, production boots
		expect(production(SECRETS)).not.toThrow();
	});
});
