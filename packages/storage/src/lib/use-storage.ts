import { StorageManager } from './storage-manager.js';

/**
 * The storage manager of the process, held at module level so it is built once.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module.
 *
 * @internal
 */
export const _cache: { storage: StorageManager | undefined } = { storage: undefined };

/**
 * Return the process-wide {@link StorageManager}, creating an empty one on first use.
 *
 * The application registers its drivers and locations on it at start-up; every later caller gets the same instance,
 * so the locations are shared across the process.
 *
 * @returns The same manager on every call.
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
export const useStorage = (): StorageManager => {
	// 1. One manager per process: a second one would instantiate every driver, and its connections, again
	if (_cache.storage) {
		return _cache.storage;
	}

	_cache.storage = new StorageManager();

	return _cache.storage;
};
