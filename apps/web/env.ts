import { useEnv } from '@novastarter/env';
import { type Singleton, singleton } from '@novastarter/utils';
import { z } from 'zod';

/**
 * An optional variable: an empty value counts as unset, the way a blank line in a `.env` file or an empty secret
 * would otherwise slip through as `''` and fail the format check.
 *
 * @typeParam T - Schema of the value when it is set.
 * @param schema - Schema of the value when it is set.
 * @returns The schema accepting `undefined` and `''` as absent.
 */
const optional = <T extends z.ZodType>(schema: T) => {
	// Normalise first, so the inner schema only ever sees a real value or nothing
	return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
};

/**
 * A flag: the spellings `z.stringbool()` reads (`true`, `1`, `yes`, `on` and their opposites), or a boolean the
 * `boolean:` cast of `@novastarter/env` already made; unset or empty is `false`.
 *
 * @returns The schema of a boolean variable.
 */
const flag = () => {
	// A cast boolean passes through, every spelling `z.stringbool()` knows is read from the raw string, and an absent
	// value falls back to `false` rather than failing the variable
	return optional(z.union([z.boolean(), z.stringbool()])).default(false);
};

/**
 * Schema of the variables this app reads: what each one is, its default, and what counts as valid.
 *
 * `useEnv()` hands over strings (plus the cast prefixes and `_FILE` secrets it resolved); the schema turns them into
 * the types the app needs, so a missing or malformed variable fails here, at start-up, with a message naming it —
 * rather than as `undefined` deep inside a driver. Unknown variables are ignored, so the platform's own variables
 * pass through untouched.
 */
export const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
	/** Console style of the logger; unset, JSON lines in production and pretty lines elsewhere. */
	LOG_STYLE: optional(z.enum(['pretty', 'raw'])),
	/** The Redis server; unset, every subsystem runs on its in-process driver. */
	REDIS: optional(z.url()),
	/** Prefix of the BullMQ keys, so several projects can share a Redis. */
	QUEUE_PREFIX: z.string().default('novastarter'),
	/** The PostgreSQL connection string; unset, the app runs on PGlite in-process under `DATABASE_PGLITE_DIR`. */
	DATABASE_URL: optional(z.url()),
	/**
	 * Directory of the in-process PGlite database used without a `DATABASE_URL`, relative to the working directory
	 * and created when missing; `memory://` for one that lives as long as the process.
	 */
	DATABASE_PGLITE_DIR: z.string().default('./data/pglite'),
	/** Apply the pending migrations of `drizzle/` when the server starts; off unless set. */
	DATABASE_MIGRATE: flag(),
	/**
	 * Which driver carries `DATABASE_URL`: plain node-postgres, Supabase with its TLS defaults, Neon over WebSocket
	 * (`neon`) or over HTTP (`neon-http`, one fetch per query, no transactions).
	 */
	DATABASE_DRIVER: z.enum(['postgres', 'supabase', 'neon', 'neon-http']).default('postgres'),
	/** PEM of the Supabase root certificate, for `DATABASE_DRIVER=supabase`; `DATABASE_SSL_CA_FILE` mounts a secret. */
	DATABASE_SSL_CA: optional(z.string()),
	/** Directory of the local storage location. */
	STORAGE_LOCAL_ROOT: z.string().default('./uploads'),
	/**
	 * Driver of the `default` mail location: `console` writes every message to the log, `sendmail` pipes it to the
	 * local `sendmail` binary. Unset, `console` outside production — a fresh clone reads its mail in the terminal —
	 * and required in production, where the console driver would log verification links and reset tokens instead of
	 * delivering them. Drivers that need more configuration (`smtp`, `file`, a vendor package) are wired in
	 * `config/mail.ts`.
	 */
	MAIL_DRIVER: z.enum(['console', 'sendmail']).optional(),
	/** Sender of every message without a `from` of its own. */
	MAIL_FROM: z.string().default('noreply@localhost'),
	/**
	 * Driver of the `default` SMS location; `console` is the only built-in one. Unset, it is the default outside
	 * production — a fresh clone reads its one-time codes in the terminal — and required in production, where the
	 * console driver would log every code instead of delivering it. A vendor driver (`@novastarter/sms-driver-*`) is
	 * wired in `config/sms.ts`.
	 */
	SMS_DRIVER: z.enum(['console']).optional(),
	/** Sender of every SMS without a `from` of its own: a number in E.164, or an alphanumeric sender id. */
	SMS_FROM: z.string().default('Novastarter'),
	/**
	 * The HMAC secret JWT access tokens are signed with: at least 32 characters of random data
	 * (`openssl rand -base64 32`). Required in production; a fixed development value is used elsewhere.
	 */
	AUTH_JWT_SECRET: optional(z.string().min(32)),
	/**
	 * The key TOTP secrets are encrypted with at rest: at least 32 characters of random data. Required in production;
	 * changing it makes every enrolled authenticator unreadable.
	 */
	AUTH_MFA_ENCRYPTION_KEY: optional(z.string().min(32)),
	/**
	 * The secret the OAuth cookie is encrypted with — it carries the state, the PKCE verifier and the nonce through
	 * the provider's redirect: at least 32 characters of random data. Required in production; a fixed development
	 * value is used elsewhere.
	 */
	AUTH_OAUTH_SECRET: optional(z.string().min(32)),
	/** The name authenticator apps show above the code. */
	AUTH_MFA_ISSUER: z.string().default('Novastarter'),
	/** Google sign-in: the OAuth client id; the provider is registered when it and the secret are set. */
	AUTH_GOOGLE_CLIENT_ID: optional(z.string()),
	/** Google sign-in: the OAuth client secret. */
	AUTH_GOOGLE_CLIENT_SECRET: optional(z.string()),
	/** GitHub sign-in: the OAuth app's client id; the provider is registered when it and the secret are set. */
	AUTH_GITHUB_CLIENT_ID: optional(z.string()),
	/** GitHub sign-in: the OAuth app's client secret. */
	AUTH_GITHUB_CLIENT_SECRET: optional(z.string()),
	/** OpenAI API key; the `openai` AI provider is registered when it is set. */
	AI_OPENAI_API_KEY: optional(z.string()),
	/** Anthropic API key; the `anthropic` AI provider is registered when it is set. */
	AI_ANTHROPIC_API_KEY: optional(z.string()),
	/** Google Generative AI (Gemini) API key; the `google` AI provider is registered when it is set. */
	AI_GOOGLE_API_KEY: optional(z.string()),
	/** Vercel AI Gateway API key; the `gateway` AI provider is registered when it is set. */
	AI_GATEWAY_API_KEY: optional(z.string()),
});

/**
 * The variables of the app, parsed and typed.
 */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parse the process configuration against {@link envSchema}, once per process.
 *
 * A function rather than a module-level constant, so the configuration is read when the app boots — not when the
 * module is first imported, which in Next.js may happen at build time. Parsed on the first call and kept: `useEnv`
 * takes its options from the call that builds it and refuses them afterwards, so this is the one call that passes
 * them. `readEnv.reset()` drops the parsed variables, for tests; the raw ones of `useEnv` are read afresh with them,
 * so a test stubbing the environment needs no second reset.
 *
 * @returns The typed variables; the same object on every call.
 * @throws ZodError listing every variable that is missing or malformed.
 * @throws Error when a `<NAME>_FILE` points to a file that cannot be read.
 */
export const readEnv: Singleton<AppEnv> = singleton(() => {
	// The raw variables are rebuilt along with the parsed ones: `useEnv` refuses options once built, and a stale raw
	// configuration under a fresh parse would defeat a reset anyway. At boot nothing is built yet
	useEnv.reset();

	// Every variable of the schema may come from a `<NAME>_FILE` — that is how the platform mounts secrets
	return envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
});
