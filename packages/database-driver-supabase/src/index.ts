/**
 * Public entry point of `@novastarter/database-driver-supabase`: the {@link DatabaseDriverSupabase} class, its options
 * and the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverSupabase } from './lib/driver.js';

export { DatabaseDriverSupabase, type DatabaseDriverSupabaseConfig } from './lib/driver.js';
export { toPostgresConfig } from './lib/to-postgres-config.js';
export default DatabaseDriverSupabase;
