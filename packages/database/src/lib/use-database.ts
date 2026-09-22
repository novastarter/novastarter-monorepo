import { type Singleton, singleton } from '@novastarter/utils';
import { DatabaseManager } from './database-manager.js';

/**
 * Return the process-wide {@link DatabaseManager}, creating an empty one on first use.
 *
 * The application registers its drivers and locations on it at start-up; every later caller gets the same instance,
 * so the connection pools are shared across the process.
 *
 * @returns The same manager on every call; `useDatabase.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const database = useDatabase();
 *
 * database.registerDriver('postgres', DatabaseDriverPostgres);
 * database.registerLocation('default', {
 * 	driver: 'postgres',
 * 	options: {
 * 		connection: env['DATABASE_URL'],
 * 		schema,
 * 	},
 * });
 *
 * // anywhere later
 * const users = await useDatabase().location().db.select().from(schema.users);
 * ```
 */
export const useDatabase: Singleton<DatabaseManager> = singleton(() => new DatabaseManager());
