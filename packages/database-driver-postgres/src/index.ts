/**
 * Public entry point of `@novastarter/database-driver-postgres`: the {@link DatabaseDriverPostgres} class, its options
 * and the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverPostgres } from './lib/driver.js';

export { DatabaseDriverPostgres, type DatabaseDriverPostgresConfig } from './lib/driver.js';
export default DatabaseDriverPostgres;
