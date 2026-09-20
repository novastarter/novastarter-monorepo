import { DriverManager } from '@novastarter/utils';
import type { StorageDriver } from '../driver.js';

/**
 * Storage drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * Empty here: each driver package adds itself with a module augmentation, so a location's `options` are checked
 * against the driver it names once the package is imported —
 * `declare module '@novastarter/storage' { interface StorageDrivers { s3: StorageDriverS3Config } }`. An application
 * does the same for a driver of its own.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the driver packages
export interface StorageDrivers {}

/**
 * Registry that maps named storage locations to driver instances.
 *
 * The {@link DriverManager} of the kit for object storage: drivers are registered as classes and locations as
 * configuration; the manager instantiates one driver per location on its first use, so a single driver (for example
 * S3) can back several buckets with different credentials and an unused location never opens a client. Order
 * matters: a location can only be registered once its driver is. The application wires it at start-up through
 * {@link useStorage}.
 *
 * @example
 * ```ts
 * const storage = new StorageManager();
 *
 * storage.registerDriver('s3', StorageDriverS3);
 * storage.registerLocation('uploads', {
 * 	driver: 's3',
 * 	options: {
 * 		bucket: 'uploads',
 * 	},
 * });
 *
 * await storage.location('uploads').write('avatar.png', stream, 'image/png');
 * ```
 */
export class StorageManager extends DriverManager<StorageDriver, StorageDrivers> {}
