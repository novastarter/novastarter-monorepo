import { defineConfig } from 'drizzle-kit';
import { readEnv } from './env';

/**
 * drizzle-kit's configuration: the schema its migrations come from, where they go, and which database `push`,
 * `migrate` and `studio` reach — the same one the app boots on, read through the app's own environment schema.
 */
const env = readEnv();

export default defineConfig({
	dialect: 'postgresql',
	schema: './db/schema.ts',
	out: './drizzle',
	// 1. A server when `DATABASE_URL` is set, PGlite on its directory otherwise — what `config/database.ts` registers
	...(env.DATABASE_URL
		? { dbCredentials: { url: env.DATABASE_URL } }
		: { driver: 'pglite', dbCredentials: { url: env.DATABASE_PGLITE_DIR } }),
});
