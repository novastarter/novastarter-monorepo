/**
 * Public entry point of `@novastarter/storage-driver-azure`: the {@link StorageDriverAzure} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { StorageDriverAzure } from './lib/driver.js';

export { StorageDriverAzure, type StorageDriverAzureConfig } from './lib/driver.js';
export default StorageDriverAzure;
