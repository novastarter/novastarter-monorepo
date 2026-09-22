/**
 * Public entry point of `@novastarter/database-driver-sqlite`: the {@link DatabaseDriverSqlite} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverSqlite } from './lib/driver.js';

export { DatabaseDriverSqlite, type DatabaseDriverSqliteConfig, MEMORY_FILE } from './lib/driver.js';
export default DatabaseDriverSqlite;
