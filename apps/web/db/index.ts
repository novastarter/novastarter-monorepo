import { useDatabase } from '@novastarter/database';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

export { users } from './schema';

/**
 * The app's database: the `default` location's Drizzle instance, typed with the app's schema.
 *
 * A function rather than a constant, so the pool — or PGlite's boot — opens on the first query, not on import.
 *
 * @returns The Drizzle database; `db.query.users` and the query builder are typed by `db/schema.ts`.
 * @example
 * ```ts
 * const people = await useDb().select().from(users);
 * ```
 */
export const useDb = (): PgDatabase<PgQueryResultHKT, typeof schema> => useDatabase().location().db;
