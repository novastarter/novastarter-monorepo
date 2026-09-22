import type { Logger } from '@novastarter/logger';

/**
 * What {@link DatabaseDriver.migrate} takes: where the drizzle-kit migrations are and where their journal is kept.
 *
 * The same three fields Drizzle's own migrators take, written with `| undefined` so a caller can pass an optional
 * value straight through; {@link toMigrationConfig} drops the undefined ones before they reach Drizzle.
 */
export type MigrateOptions = {
	/** Folder drizzle-kit generated: the `.sql` files and their `meta/_journal.json`. */
	migrationsFolder: string;
	/** Table Drizzle records the applied migrations in. @defaultValue `__drizzle_migrations` */
	migrationsTable?: string | undefined;
	/** Schema that table lives in; PostgreSQL only. @defaultValue `drizzle` */
	migrationsSchema?: string | undefined;
};

/**
 * How Drizzle maps the property names of a schema to column names when a column declares none.
 */
export type DatabaseCasing = 'snake_case' | 'camelCase';

/**
 * What Drizzle calls for every query it runs, when query logging is on.
 *
 * A structural twin of Drizzle's own `Logger` interface, so this package needs no dependency on `drizzle-orm`: the
 * drivers hand Drizzle whatever satisfies this shape, and {@link createQueryLogger} builds one over the kit logger.
 */
export interface QueryLogger {
	/**
	 * Record one query.
	 *
	 * @param query - The SQL text with placeholders.
	 * @param params - The values bound to the placeholders.
	 */
	logQuery(query: string, params: unknown[]): void;
}

/**
 * The options every driver hands to its dialect's `drizzle()` call.
 *
 * No `| undefined` on the optional fields on purpose: Drizzle's `DrizzleConfig` declares them without it, so under
 * `exactOptionalPropertyTypes` a key holding `undefined` would not compile. {@link toDrizzleOptions} builds this
 * object with only the keys that carry a value.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DrizzleOptions<Schema extends Record<string, unknown>> = {
	/** The schema, for the relational query API and the typing of `db`. */
	schema?: Schema;
	/** Column-name casing. */
	casing?: DatabaseCasing;
	/** Where every query goes. */
	logger?: QueryLogger;
};

/**
 * The options every driver shares; each driver adds its own connection fields on top.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with; the tables and relations the application
 * defines with `pgTable` or `sqliteTable`.
 */
export type DatabaseDriverCommonConfig<Schema extends Record<string, unknown> = Record<string, unknown>> = {
	/** The Drizzle schema, so `db.query` knows the tables and `db` is typed with them; none for raw SQL only. */
	schema?: Schema | undefined;
	/** How property names become column names when a column declares none. */
	casing?: DatabaseCasing | undefined;
	/** Where connection errors and, with `queryLogging`, every query are reported; the process logger unless given. */
	logger?: Logger | undefined;
	/** Log every query with its parameters at `debug` through `logger`. @defaultValue false */
	queryLogging?: boolean | undefined;
};
