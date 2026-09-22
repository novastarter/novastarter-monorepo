/**
 * Public entry point of `@novastarter/database-driver-pglite`: the {@link DatabaseDriverPglite} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverPglite } from './lib/driver.js';

export {
	DatabaseDriverPglite,
	type DatabaseDriverPgliteConfig,
	type DatabaseDriverPgliteOptions,
	dataDirectory,
	MEMORY_DATA_DIR,
} from './lib/driver.js';
export default DatabaseDriverPglite;
