import type { Readable } from 'node:stream';
import type { ChunkedUploadContext, ReadOptions, Stat } from './types.js';

/**
 * Contract every storage driver implements.
 *
 * Declared as an ambient class rather than an interface so that `typeof StorageDriver` describes a constructor for
 * {@link StorageManager.registerDriver}; no runtime code exists behind it. All paths are relative to the driver's
 * configured root and use forward slashes.
 */
export declare class StorageDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Open a readable stream over an object.
	 *
	 * @param filepath - Object path relative to the driver root.
	 * @param options - Optional byte range or version to read.
	 * @returns A stream of the object's contents.
	 * @throws StorageFileNotFoundError when the backend refuses the read up front; a driver that opens a lazy stream
	 * (the local one) reports a missing file on the stream instead.
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
	 * @throws StorageFileNotFoundError when there is no object at the path.
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

	/**
	 * Release what the driver holds — an SDK's HTTP agents, open sockets — so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}

/**
 * Driver that additionally supports resumable uploads following the TUS protocol.
 *
 * The TUS server calls the chunked-upload methods in this order: create once, write a chunk per PATCH request, then
 * finish or delete. The {@link ChunkedUploadContext} carries the driver's state between those calls.
 */
export interface TusDriver extends StorageDriver {
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
