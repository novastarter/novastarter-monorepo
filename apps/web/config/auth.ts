import type { AuthDrivers, AuthSettings } from '@novastarter/auth';
import { InvalidConfigError } from '@novastarter/errors';
import type { LimiterDrivers } from '@novastarter/memory';
import type { LocationConfig } from '@novastarter/utils';
import type { Redis } from 'ioredis';
import { findUser, saveRehash } from '../auth/find-user';
import type { AppEnv } from '../env';

/**
 * JWT secret outside production when `AUTH_JWT_SECRET` is unset: public, so a token signed with it proves nothing — a
 * fresh clone runs without configuration, and production refuses it.
 *
 * @internal
 */
const DEVELOPMENT_JWT_SECRET = 'development-only-jwt-secret-do-not-use-in-production';

/**
 * TOTP encryption key outside production when `AUTH_MFA_ENCRYPTION_KEY` is unset; public, like the JWT secret.
 *
 * @internal
 */
const DEVELOPMENT_MFA_KEY = 'development-only-mfa-key-do-not-use-in-production';

/**
 * OAuth cookie secret outside production when `AUTH_OAUTH_SECRET` is unset; public, like the JWT secret.
 *
 * @internal
 */
const DEVELOPMENT_OAUTH_SECRET = 'development-only-oauth-secret-do-not-use-in-production';

/**
 * The names of the limiter locations the auth settings use.
 */
export type AuthLimiterName = 'auth-sign-in' | 'auth-mfa' | 'auth-code';

/**
 * The auth configuration of the app: a location per sign-in provider, the limiter locations and the settings, the
 * limiters aside — the bootstrap resolves them from the limiter manager.
 *
 * There is no store: the package keeps no records, the app stores them in its own tables through the modules under
 * `auth/`.
 */
export interface AuthConfig {
	providers: Record<string, LocationConfig<AuthDrivers>>;
	limiters: Record<AuthLimiterName, LocationConfig<LimiterDrivers>>;
	settings: Omit<AuthSettings, 'limiters'>;
}

/**
 * What the auth configuration builds on: the shared Redis client for the limiters.
 */
export interface AuthConfigDeps {
	/** The shared Redis client, when the app has one. */
	redis: Redis | undefined;
}

/**
 * The auth configuration: providers, limiters and settings.
 *
 * Credentials always sign in, on the `users` table; Google and GitHub join when their keys are set, so a fresh
 * clone runs with none of them. Budgets: 10 sign-in attempts per account per 15 minutes, 5 TOTP or recovery codes per
 * user per 5 minutes, 5 one-time codes per user and purpose per 10 minutes — on Redis when there is one, so every
 * process shares them.
 *
 * @param env - The app's variables.
 * @param deps - The Redis client.
 * @returns The configuration to register.
 * @throws InvalidConfigError in production without `AUTH_JWT_SECRET`, `AUTH_MFA_ENCRYPTION_KEY` or `AUTH_OAUTH_SECRET`: the
 * development values are public.
 */
export const authConfig = (env: AppEnv, deps: AuthConfigDeps): AuthConfig => {
	// Production must bring its own secrets; elsewhere the public development ones keep a fresh clone running
	if (
		env.NODE_ENV === 'production' &&
		(!env.AUTH_JWT_SECRET || !env.AUTH_MFA_ENCRYPTION_KEY || !env.AUTH_OAUTH_SECRET)
	) {
		throw new InvalidConfigError({
			reason:
				'AUTH_JWT_SECRET, AUTH_MFA_ENCRYPTION_KEY and AUTH_OAUTH_SECRET are required in production: the development values are public, set your own',
		});
	}

	// The public development values never reach production: the check above refuses to boot without real secrets.
	return {
		providers: providers(env),
		limiters: limiters(deps.redis),
		settings: {
			jwt: { secret: env.AUTH_JWT_SECRET ?? DEVELOPMENT_JWT_SECRET },
			mfa: { issuer: env.AUTH_MFA_ISSUER, encryptionKey: env.AUTH_MFA_ENCRYPTION_KEY ?? DEVELOPMENT_MFA_KEY },
			oauth: { secret: env.AUTH_OAUTH_SECRET ?? DEVELOPMENT_OAUTH_SECRET },
		},
	};
};

/**
 * A location per sign-in provider the app has keys for.
 *
 * @param env - The app's variables.
 * @returns The locations, by name.
 * @internal
 */
const providers = (env: AppEnv): Record<string, LocationConfig<AuthDrivers>> => {
	// Credentials always: the app's own accounts, by email and password
	const locations: Record<string, LocationConfig<AuthDrivers>> = {
		credentials: { driver: 'credentials', options: { findUser, onRehash: saveRehash } },
	};

	// Each provider only with its complete set of keys; half a set would fail on the first sign-in instead of here
	if (env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET) {
		locations['google'] = {
			driver: 'google',
			options: { clientId: env.AUTH_GOOGLE_CLIENT_ID, clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET },
		};
	}

	if (env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET) {
		locations['github'] = {
			driver: 'github',
			options: { clientId: env.AUTH_GITHUB_CLIENT_ID, clientSecret: env.AUTH_GITHUB_CLIENT_SECRET },
		};
	}

	return locations;
};

/**
 * The limiter locations of the guessable auth steps.
 *
 * @param redis - The shared Redis client, when the app has one.
 * @returns The locations, by name.
 * @internal
 */
const limiters = (redis: Redis | undefined): Record<AuthLimiterName, LocationConfig<LimiterDrivers>> => {
	// Points per duration in seconds, per key: an account, a user, a user and purpose
	const budgets: Record<AuthLimiterName, { points: number; duration: number }> = {
		'auth-sign-in': { points: 10, duration: 15 * 60 },
		'auth-mfa': { points: 5, duration: 5 * 60 },
		'auth-code': { points: 5, duration: 10 * 60 },
	};

	// On the shared server when there is one, so a guesser gains nothing by hitting another process
	return Object.fromEntries(
		Object.entries(budgets).map(([name, budget]) => [
			name,
			redis
				? { driver: 'redis', options: { redis, namespace: name, ...budget } }
				: { driver: 'local', options: budget },
		]),
	) as Record<AuthLimiterName, LocationConfig<LimiterDrivers>>;
};
