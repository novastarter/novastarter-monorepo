/**
 * Public entry point of `@novastarter/storage-driver-s3`: the {@link StorageDriverS3} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { StorageDriverS3 } from './lib/driver.js';

export { DEFAULT_S3_CALL_TIMEOUT, StorageDriverS3, type StorageDriverS3Config } from './lib/driver.js';
export type { ChecksumMode } from './types.js';
export default StorageDriverS3;
