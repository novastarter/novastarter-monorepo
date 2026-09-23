/**
 * Public entry point of `@novastarter/storage-driver-cloudinary`: the {@link StorageDriverCloudinary} class, its
 * options and the default export for consumers that import the driver without a named binding.
 */
import { StorageDriverCloudinary } from './lib/driver.js';

export {
	DEFAULT_CLOUDINARY_CALL_TIMEOUT,
	StorageDriverCloudinary,
	type StorageDriverCloudinaryConfig,
} from './lib/driver.js';
export default StorageDriverCloudinary;
