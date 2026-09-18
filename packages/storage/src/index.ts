import type { Readable } from 'node:stream';
import type { ChunkedUploadContext, Range, ReadOptions, Stat } from '@novastarter/types';

/**
 * Registry that maps named storage locations to driver instances.
 *
 * Drivers are registered as classes and locations as configuration; the manager instantiates one driver per
 * location, so a single driver (for example S3) can back several buckets with different credentials. Order matters:
 * a location can only be registered once its driver is.
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
export class StorageManager {
	/**
	 * Driver classes keyed by the name they were registered under.
	 *
	 * @internal
	 */
	private drivers = new Map<string, typeof Driver>();

	/**
	 * Instantiated drivers keyed by location name.
	 *
	 * @internal
	 */
	private locations = new Map<string, Driver>();

	/**
	 * Make a driver class available under a name for locations to reference.
	 *
	 * Registering a name twice replaces the earlier class; locations created before the replacement keep their
	 * existing instance.
	 *
	 * @param name - Identifier used in {@link DriverConfig.driver}.
	 * @param driver - Driver class implementing the {@link Driver} contract.
	 */
	registerDriver(name: string, driver: typeof Driver): void {
		// 1. A plain Map write is enough: a duplicate name replaces the earlier class, as the JSDoc promises
		this.drivers.set(name, driver);
	}

	/**
	 * Create a driver instance for a named location.
	 *
	 * @param name - Location identifier used later with {@link StorageManager.location}.
	 * @param config - Which driver to use and the options passed to its constructor.
	 * @throws Error when `config.driver` names a driver that has not been registered.
	 */
	registerLocation(name: string, config: DriverConfig): void {
		const driverName = config.driver;

		// 1. Resolve the driver class up front, so a typo in the config fails at registration rather than on first use
		const Driver = this.drivers.get(driverName);

		if (!Driver) {
			throw new Error(`Driver "${driverName}" isn't registered.`);
		}

		// 2. Instantiate eagerly: drivers set up their clients in the constructor, and doing that once per location
		//    shares connections across every call made through that location
		this.locations.set(name, new Driver(config.options));
	}

	/**
	 * Return the driver instance behind a registered location.
	 *
	 * @param name - Location identifier passed to {@link StorageManager.registerLocation}.
	 * @returns The driver bound to that location.
	 * @throws Error when no location with that name exists.
	 */
	location(name: string): Driver {
		const driver = this.locations.get(name);

		// 1. Fail loudly instead of returning `undefined`: callers chain storage calls on the result, and a missing
		//    location is a configuration bug that deserves a clear message
		if (!driver) {
			throw new Error(`Location "${name}" doesn't exist.`);
		}

		return driver;
	}
}

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
export type DriverConfig = {
	/** Name the driver was registered under. */
	driver: string;
	/** Options forwarded verbatim to the driver constructor. */
	options: Record<string, unknown>;
};

/**
 * Storage types re-exported for consumers that depend on this package alone.
 */
export type { Range, Stat, ReadOptions, ChunkedUploadContext };
