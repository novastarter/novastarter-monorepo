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
 * What a driver's dialect and transport can do, so an application picks `db.transaction()` or `db.batch()` by fact
 * rather than by driver name.
 */
export type DatabaseCapabilities = {
	/**
	 * Whether `db.transaction()` works: `false` over Neon's HTTP transport, which holds no session, and on Cloudflare
	 * D1, which refuses the `begin` Drizzle sends; `db.batch()` is the one transaction those two offer.
	 *
	 * This says nothing about prepared statements: `.prepare(name)` may be rejected where plain transactions work —
	 * on Supabase's transaction pooler (port 6543) — and Drizzle's relational query builder sends named prepares, so
	 * it fails there while `db.transaction()` succeeds.
	 */
	readonly transactions: boolean;
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
 * What switching query logging on carries: the SQL text is always logged, the bound parameter values only on request.
 *
 * @example
 * ```ts
 * queryLogging: { params: true }
 * ```
 */
export type QueryLoggingOptions = {
	/**
	 * Log the bound parameter values verbatim, next to the SQL text.
	 *
	 * Off by default: at `debug` level in production the values carry what users typed — password hashes, tokens, PII —
	 * and the kit logger's redaction works on known paths, which cannot reach values inside the `params` array. The
	 * parameter count is logged instead, so the line stays useful without the values.
	 *
	 * @defaultValue false
	 */
	params?: boolean | undefined;
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
	/**
	 * Log every query at `debug` through `logger`: the SQL text with the parameter count, or the values too as
	 * `queryLogging: { params: true }`. @defaultValue false
	 */
	queryLogging?: boolean | QueryLoggingOptions | undefined;
	/**
	 * The location's name, carried by every log line (`database`) and by {@link DatabaseUnavailableError};
	 * {@link DatabaseManager.registerLocation} fills it in, so a location never has to.
	 */
	label?: string | undefined;
};
