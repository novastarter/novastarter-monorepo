/**
 * Public entry point of `@novastarter/storage-driver-supabase`: the {@link StorageDriverSupabase} class, its
 * options and the default export for consumers that import the driver without a named binding.
 */
import { StorageDriverSupabase } from './lib/driver.js';

export { StorageDriverSupabase, type StorageDriverSupabaseConfig } from './lib/driver.js';
export default StorageDriverSupabase;
