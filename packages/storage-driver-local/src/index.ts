/**
 * Public entry point of `@novastarter/storage-driver-local`: the {@link StorageDriverLocal} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { StorageDriverLocal } from './lib/driver.js';

export { StorageDriverLocal, type StorageDriverLocalConfig } from './lib/driver.js';
export default StorageDriverLocal;
