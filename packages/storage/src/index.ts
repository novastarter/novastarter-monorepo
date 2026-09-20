import type { Readable } from 'node:stream';
import type { ChunkedUploadContext, Range, ReadOptions, Stat } from '@novastarter/types';
import { DriverManager, type LocationConfig } from '@novastarter/utils';

/**
 * Registry that maps named storage locations to driver instances.
 *
 * The {@link DriverManager} of the kit for object storage: drivers are registered as classes and locations as
 * configuration; the manager instantiates one driver per location, so a single driver (for example S3) can back
 * several buckets with different credentials. Order matters: a location can only be registered once its driver is.
 * The application wires it at start-up through {@link useStorage}.
 *
 * @example
 * ```ts
 * const storage = new StorageManager();
 *
 * storage.registerDriver('s3', DriverS3);
 * storage.registerLocation('uploads', { driver: 's3', options: { bucket: 'uploads' } });
 *
 * await storage.location('uploads').write('avatar.png', stream, 'image/png');
 * ```
 */
export class StorageManager extends DriverManager<Driver, Record<string, unknown>> {}

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
 * storage.registerDriver('s3', DriverS3);
 * storage.registerLocation('uploads', { driver: 's3', options: { bucket: env['STORAGE_UPLOADS_BUCKET'] } });
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

/**
 * Contract every storage driver implements.
 *
 * Declared as an ambient class rather than an interface so that `typeof Driver` describes a constructor for
 * {@link StorageManager.registerDriver}; no runtime code exists behind it. All paths are relative to the driver's
 * configured root and use forward slashes.
 */
export declare class Driver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options as given in {@link DriverConfig.options}.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Open a readable stream over an object.
	 *
	 * @param filepath - Object path relative to the driver root.
	 * @param options - Optional byte range or version to read.
	 * @returns A stream of the object's contents.
	 */
	read(filepath: string, options?: ReadOptions): Promise<Readable>;

	/**
	 * Write a stream to an object, replacing any existing content.
	 *
	 * @param filepath - Object path relative to the driver root.
	 * @param content - Data to store.
	 * @param type - MIME type to record with the object when the backend supports it.
	 */
	write(filepath: string, content: Readable, type?: string): Promise<void>;

	/**
	 * Remove an object.
	 *
	 * @param filepath - Object path relative to the driver root.
	 */
	delete(filepath: string): Promise<void>;

	/**
	 * Read an object's size and modification time.
	 *
	 * @param filepath - Object path relative to the driver root.
	 * @returns The object's metadata.
	 */
	stat(filepath: string): Promise<Stat>;

	/**
	 * Check whether an object is present.
	 *
	 * @param filepath - Object path relative to the driver root.
	 * @returns `true` when the object exists.
	 */
	exists(filepath: string): Promise<boolean>;

	/**
	 * Move an object to a new path.
	 *
	 * @param src - Current object path.
	 * @param dest - Path to move the object to.
	 */
	move(src: string, dest: string): Promise<void>;

	/**
	 * Duplicate an object under a new path.
	 *
	 * @param src - Object to copy.
	 * @param dest - Path of the copy.
	 */
	copy(src: string, dest: string): Promise<void>;

	/**
	 * Enumerate object paths under a prefix.
	 *
	 * @param prefix - Path prefix to filter by; every object when omitted.
	 * @returns Object paths relative to the driver root, produced lazily.
	 */
	list(prefix?: string): AsyncIterable<string>;
}

/**
 * Driver that additionally supports resumable uploads following the TUS protocol.
 *
 * The TUS server calls the chunked-upload methods in this order: create once, write a chunk per PATCH request, then
 * finish or delete. The {@link ChunkedUploadContext} carries the driver's state between those calls.
 */
export interface TusDriver extends Driver {
	/**
	 * TUS protocol extensions this driver supports, advertised to clients in the `Tus-Extension` header.
	 */
	get tusExtensions(): string[];

	/**
	 * Start a resumable upload.
	 *
	 * @param filepath - Final object path.
	 * @param context - Client-supplied size and metadata.
	 * @returns The context, extended with whatever the driver needs on later calls.
	 */
	createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext>;

	/**
	 * Assemble the uploaded chunks into the final object.
	 *
	 * @param filepath - Final object path.
	 * @param context - Context returned by {@link TusDriver.createChunkedUpload}.
	 */
	finishChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void>;

	/**
	 * Abort a resumable upload and discard its chunks.
	 *
	 * @param filepath - Final object path.
	 * @param context - Context returned by {@link TusDriver.createChunkedUpload}.
	 */
	deleteChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void>;

	/**
	 * Append a chunk to a resumable upload.
	 *
	 * @param filepath - Final object path.
	 * @param content - Chunk data.
	 * @param offset - Byte offset within the upload where this chunk starts.
	 * @param context - Context returned by {@link TusDriver.createChunkedUpload}.
	 * @returns The upload offset after this chunk, which the TUS server reports back to the client.
	 */
	writeChunk(filepath: string, content: Readable, offset: number, context: ChunkedUploadContext): Promise<number>;
}

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
export function supportsTus(driver: Driver): driver is TusDriver {
	// 1. Presence of the getter is the only reliable runtime signal: `Driver` is ambient, so there is no base class
	//    or marker symbol to test against
	return 'tusExtensions' in driver;
}

/**
 * Location entry as passed to {@link StorageManager.registerLocation}.
 */
export type DriverConfig = LocationConfig<Record<string, unknown>>;

/**
 * Storage types re-exported for consumers that depend on this package alone.
 */
export type { Range, Stat, ReadOptions, ChunkedUploadContext };
