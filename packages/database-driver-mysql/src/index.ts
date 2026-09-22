/**
 * Public entry point of `@novastarter/database-driver-mysql`: the {@link DatabaseDriverMysql} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverMysql } from './lib/driver.js';

export { DatabaseDriverMysql, type DatabaseDriverMysqlConfig } from './lib/driver.js';
export default DatabaseDriverMysql;
