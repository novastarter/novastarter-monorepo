import { useEnv } from '@novastarter/env';
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
	// 1. Normalise first, so the inner schema only ever sees a real value or nothing
	return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
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
	/** Directory of the local storage location. */
	STORAGE_LOCAL_ROOT: z.string().default('./uploads'),
});

/**
 * The variables of the app, parsed and typed.
 */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parse the process configuration against {@link envSchema}.
 *
 * A function rather than a module-level constant, so the configuration is read when the app boots — not when the
 * module is first imported, which in Next.js may happen at build time.
 *
 * @returns The typed variables.
 * @throws ZodError listing every variable that is missing or malformed.
 * @throws Error when a `<NAME>_FILE` points to a file that cannot be read.
 */
export const readEnv = (): AppEnv => {
	// 1. Every variable of the schema may come from a `<NAME>_FILE` — that is how the platform mounts secrets
	return envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
};
