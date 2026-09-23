/**
 * Public entry point of `@novastarter/storage-driver-gcs`: the {@link StorageDriverGcs} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { StorageDriverGcs } from './lib/driver.js';

export { DEFAULT_GCS_CALL_TIMEOUT, StorageDriverGcs, type StorageDriverGcsConfig } from './lib/driver.js';
export default StorageDriverGcs;
