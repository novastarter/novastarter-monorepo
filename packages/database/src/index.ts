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
export {
	DatabaseUnavailableError,
	type DatabaseUnavailableErrorExtensions,
	toUnavailableError,
} from './errors/index.js';
export { createQueryLogger } from './lib/create-query-logger.js';
export {
	type DatabaseDrivers,
	type DatabaseLocations,
	DatabaseManager,
	type LocationDb,
} from './lib/database-manager.js';
export { ensureDirectory } from './lib/ensure-directory.js';
export { resolveLogger } from './lib/resolve-logger.js';
export { toDrizzleOptions } from './lib/to-drizzle-options.js';
export { type MigrationConfig, toMigrationConfig } from './lib/to-migration-config.js';
export { useDatabase } from './lib/use-database.js';
export type {
	DatabaseCapabilities,
	DatabaseCasing,
	DatabaseDriverCommonConfig,
	DrizzleOptions,
	MigrateOptions,
	QueryLogger,
	QueryLoggingOptions,
} from './types.js';
