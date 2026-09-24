import type { StorageDriver, TusDriver } from '../driver.js';

/**
 * Narrow a driver to {@link TusDriver} when it implements resumable uploads.
 *
 * @param driver - Any registered driver.
 * @returns `true` when the driver exposes `tusExtensions`, the one member every TUS driver must have.
 * @example
 * ```ts
 * const driver = storage.location('uploads');
 *
 * if (supportsTus(driver)) {
 *     await driver.createChunkedUpload(path, context);
 * }
 * ```
 */
export function supportsTus(driver: StorageDriver): driver is TusDriver {
	// Presence of the getter is the only reliable runtime signal: `StorageDriver` is ambient, so there is no base
	// class or marker symbol to test against
	return 'tusExtensions' in driver;
}
