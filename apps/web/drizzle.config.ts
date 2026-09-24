import { defineConfig } from 'drizzle-kit';
import { readEnv } from './env';

/**
 * The app's variables, parsed — drizzle-kit runs against the same database configuration the app itself boots on.
 */
const env = readEnv();

/**
 * drizzle-kit's configuration: the schema its migrations come from, where they go, and which database `push`,
 * `migrate` and `studio` reach — the same one the app boots on, read through the app's own environment schema.
 */
export default defineConfig({
	dialect: 'postgresql',
	schema: './db/schema.ts',
	out: './drizzle',
	// A server when `DATABASE_URL` is set, PGlite on its directory otherwise — what `config/database.ts` registers
	...(env.DATABASE_URL
		? { dbCredentials: { url: env.DATABASE_URL } }
		: { driver: 'pglite', dbCredentials: { url: env.DATABASE_PGLITE_DIR } }),
});
