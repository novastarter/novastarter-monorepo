/**
 * Public entry point of `@novastarter/database`.
 *
 * Relational databases on Drizzle ORM in three parts: the {@link DatabaseDriver} contract (the drivers themselves live
 * in the `@novastarter/database-driver-*` packages), the {@link DatabaseManager} of {@link useDatabase} mapping named
 * locations to drivers — with {@link DatabaseLocations} typing what each location's `db` is — the error every
 * `ping()` throws, {@link DatabaseUnavailableError}, and the helpers a driver is built with: {@link toDrizzleOptions},
 * {@link toMigrationConfig}, {@link createQueryLogger}, {@link resolveLogger}, {@link ensureDirectory},
 * {@link toUnavailableError}.
 */
export type { DatabaseDriver } from './driver.js';
export * from './errors/index.js';
export * from './lib/create-query-logger.js';
export * from './lib/database-manager.js';
export * from './lib/ensure-directory.js';
export * from './lib/resolve-logger.js';
export * from './lib/to-drizzle-options.js';
export * from './lib/to-migration-config.js';
export * from './lib/use-database.js';
export * from './types.js';
