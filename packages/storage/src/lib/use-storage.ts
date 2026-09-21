import { type Singleton, singleton } from '@novastarter/utils';
import { StorageManager } from './storage-manager.js';

/**
 * Return the process-wide {@link StorageManager}, creating an empty one on first use.
 *
 * The application registers its drivers and locations on it at start-up; every later caller gets the same instance,
 * so the locations are shared across the process.
 *
 * @returns The same manager on every call; `useStorage.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * const storage = useStorage();
 *
 * storage.registerDriver('s3', StorageDriverS3);
 * storage.registerLocation('uploads', {
 * 	driver: 's3',
 * 	options: {
 * 		bucket: env['STORAGE_UPLOADS_BUCKET'],
 * 	},
 * });
 *
 * // anywhere later
 * await useStorage().location('uploads').write('avatar.png', stream, 'image/png');
 * ```
 */
export const useStorage: Singleton<StorageManager> = singleton(() => new StorageManager());
