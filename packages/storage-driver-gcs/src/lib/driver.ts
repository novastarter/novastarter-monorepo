import { type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
	Bucket,
	CreateReadStreamOptions,
	FileMetadata,
	GetFilesOptions,
	StorageOptions,
} from '@google-cloud/storage';
import { Storage } from '@google-cloud/storage';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	type TusDriver,
} from '@novastarter/storage';
import { joinPath, normalizePath } from '@novastarter/utils';

/**
 * Smallest chunk size GCS accepts for a resumable upload: 256 KiB, `262_144` bytes.
 *
 * Every chunk but the last has to be a multiple of 256 KiB, so a smaller `chunkSize` would be rejected by the API on
 * the first PATCH.
 */
const MINIMUM_CHUNK_SIZE = 262_144;

/**
 * Options accepted by {@link StorageDriverGcs}.
 *
 * `bucket`, `root` and `tus` belong to the driver; the remaining keys (`apiEndpoint`) are handed to the `Storage`
 * client untouched. Credentials are not configured here: the client picks them up through Application Default
 * Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, the metadata server, …).
 */
export type StorageDriverGcsConfig = {
	/** Path prefix every file is placed under; behaves like a root directory inside the bucket. */
	root?: string | undefined;
	/** Bucket every operation targets. */
	bucket: string;
	/** Custom API endpoint, for emulators or private access points. */
	apiEndpoint?: string | undefined;
	/** Resumable-upload tuning. */
	tus?:
		| {
				/** Whether chunked uploads are in use; turns on validation of `chunkSize`. */
				enabled: boolean;
				/**
				 * Chunk size in bytes per upload request; a power of two of at least 256 KiB.
				 *
				 * @defaultValue {@link DEFAULT_CHUNK_SIZE}
				 */
				chunkSize?: number | undefined;
		  }
		| undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `gcs` has its
 * options checked against {@link StorageDriverGcsConfig}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		gcs: StorageDriverGcsConfig;
	}
}

/**
 * Storage driver backed by Google Cloud Storage.
 *
 * Plain operations go through `@google-cloud/storage` `File` handles. Resumable (TUS) uploads map onto GCS's own
 * resumable-upload sessions: the session URI is created once and kept in the upload context, and every incoming
 * chunk is streamed into that session as a partial upload together with the running CRC32C hash, so no server-side
 * part bookkeeping is needed.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverGcs } from '@novastarter/storage-driver-gcs';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('gcs', StorageDriverGcs);
 * storage.registerLocation('uploads', {
 * 	driver: 'gcs',
 * 	options: {
 * 		bucket: env.STORAGE_GCS_BUCKET,
 * 		root: 'avatars',
 * 	},
 * });
 * ```
 */
export class StorageDriverGcs implements TusDriver {
	/**
	 * Normalised root prefix; an empty string when none was configured.
	 *
	 * @internal
	 */
	private root: string;

	/**
	 * Bucket handle every object operation goes through.
	 *
	 * @internal
	 */
	private bucket: Bucket;

	/**
	 * Chunk size handed to resumable uploads, taken from `tus.chunkSize` or {@link DEFAULT_CHUNK_SIZE}.
	 *
	 * @internal
	 */
	private readonly preferredChunkSize: number;

	/**
	 * Create a driver together with its client and bucket handle.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws Error when TUS is enabled and `chunkSize` is not a power of two of at least 256 KiB.
	 */
	constructor(config: StorageDriverGcsConfig) {
		const { bucket, root, tus, apiEndpoint } = config;

		// 1. Every operation targets the bucket, so a missing one is refused here rather than on the first request
		if (!bucket) {
			throw new Error('The gcs storage driver needs a "bucket"');
		}

		// 2. Normalise the root once without a leading slash: object names are not paths, and a leading `/` would become
		//    part of the name and produce objects nobody can find by the expected key
		this.root = root ? normalizePath(root, { removeLeading: true }) : '';

		// 3. Only the options that were given reach the client: an explicit `undefined` is not the same as an absent key
		//    to the SDK's option types
		const storageOptions: StorageOptions = {};

		if (apiEndpoint !== undefined) {
			storageOptions.apiEndpoint = apiEndpoint;
		}

		// 4. Build the client and bucket up front, so configuration mistakes fail at construction instead of on the
		//    first request
		const storage = new Storage(storageOptions);
		this.bucket = storage.bucket(bucket);

		this.preferredChunkSize = tus?.chunkSize || DEFAULT_CHUNK_SIZE;

		// 5. GCS requires resumable chunks to be multiples of 256 KiB; restricting to powers of two keeps every chunk
		//    aligned and rejects a misconfiguration here rather than on the first PATCH
		if (
			tus?.enabled &&
			(this.preferredChunkSize < MINIMUM_CHUNK_SIZE || Math.log2(this.preferredChunkSize) % 1 !== 0)
		) {
			throw new Error('The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB');
		}
	}

	/**
	 * Resolve a caller path to the object name inside the bucket.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The object name with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. `joinPath` copes with an empty root and doubled slashes and always produces the forward slashes object
		//    names use, whatever the platform's separator
		return joinPath(this.root, filepath);
	}

	/**
	 * Get the `File` handle for an object name.
	 *
	 * @param filepath - Full object name, already resolved through {@link StorageDriverGcs.fullPath}.
	 * @returns A lazy handle; no request is made until a method on it is called.
	 * @internal
	 */
	private file(filepath: string) {
		// 1. Kept as a separate method so tests can swap the handle factory without touching the bucket
		return this.bucket.file(filepath);
	}

	/**
	 * Stream an object's contents.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns A readable stream of the object body.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		const streamOptions: CreateReadStreamOptions = {};

		// 1. Copy only the bounds that were set; the SDK reads `start`/`end` as inclusive byte offsets and defaults a
		//    missing side to the start or the end of the object. Presence, not truthiness: `end: 0` asks for the first
		//    byte, not for the whole object
		if (range?.start !== undefined) streamOptions.start = range.start;
		if (range?.end !== undefined) streamOptions.end = range.end;

		return this.file(this.fullPath(filepath)).createReadStream(streamOptions);
	}

	/**
	 * Store a stream as an object, replacing any existing one.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param content - Data to store.
	 */
	async write(filepath: string, content: Readable): Promise<void> {
		const file = this.file(this.fullPath(filepath));

		// 1. A single non-resumable request: it avoids the extra session round-trip, and resumable uploads have their own
		//    path through `writeChunk`
		const stream = file.createWriteStream({ resumable: false });

		// 2. `pipeline` propagates errors from either side and closes both streams, unlike a bare `pipe`
		await pipeline(content, stream);
	}

	/**
	 * Delete an object.
	 *
	 * @param filepath - Object path relative to the root.
	 */
	async delete(filepath: string): Promise<void> {
		// 1. No `ignoreNotFound`: a missing object rejects, so callers learn the path never existed instead of assuming it
		//    was removed
		await this.file(this.fullPath(filepath)).delete();
	}

	/**
	 * Read an object's size and last-modified time from its metadata.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws The SDK error when the object is missing or the request fails.
	 */
	async stat(filepath: string): Promise<Stat> {
		let metadata: FileMetadata;

		// 1. A 404 from the API is the one answer that confirms the object is missing; it becomes the error every backend
		//    shares, anything else says nothing about the object and is rethrown
		try {
			[metadata] = await this.file(this.fullPath(filepath)).getMetadata();
		} catch (error) {
			if ((error as { code?: number })?.code === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 2. The SDK types `size` as `string | number` and `updated` as a string; GCS returns an ISO timestamp, so it is
		//    converted into the `Date` the storage contract expects
		return { size: metadata.size as number, modified: new Date(metadata.updated as string) };
	}

	/**
	 * Check whether an object exists.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns `true` when the object is present.
	 * @throws The SDK error when the lookup itself fails; only a clean "not found" is reported as `false`.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. The SDK answers with a one-element tuple; a failed request rejects and has to keep travelling, because
		//    reporting it as a missing file would make callers act on a wrong answer
		return (await this.file(this.fullPath(filepath)).exists())[0];
	}

	/**
	 * Move an object to a new path.
	 *
	 * @param src - Current object path relative to the root.
	 * @param dest - New object path relative to the root.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. The SDK performs the move as a server-side copy followed by a delete, so no bytes travel through this process
		await this.file(this.fullPath(src)).move(this.file(this.fullPath(dest)));
	}

	/**
	 * Copy an object to a new path.
	 *
	 * @param src - Source object path relative to the root.
	 * @param dest - Destination object path relative to the root.
	 */
	async copy(src: string, dest: string): Promise<void> {
		// 1. A server-side copy; the destination handle carries the target name, so no bytes travel through this process
		await this.file(this.fullPath(src)).copy(this.file(this.fullPath(dest)));
	}

	/**
	 * Enumerate object paths under a prefix, page by page.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. Manual pagination in pages of 500: with `autoPaginate` the SDK would buffer the whole listing in memory
		//    before returning, while yielding per page keeps memory flat for large buckets
		let query: GetFilesOptions = {
			prefix: this.fullPath(prefix),
			autoPaginate: false,
			maxResults: 500,
		};

		// 2. The SDK hands back the query for the next page, or nothing once the listing is exhausted
		while (query) {
			const [files, nextQuery] = await this.bucket.getFiles(query);

			// 3. Strip the root, so callers get paths in the form they pass in
			for (const file of files) {
				yield file.name.substring(this.root.length);
			}

			query = nextQuery as GetFilesOptions;
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 */
	get tusExtensions(): string[] {
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Open a GCS resumable-upload session for a chunked upload.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Client-supplied size and metadata.
	 * @returns The same context with the session `uri` stored in its metadata for the following calls.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		const file = this.file(this.fullPath(filepath));

		// 1. The session URI is the only state GCS needs to accept further chunks; it lives in the context so a resumed
		//    upload on another process can continue the same session
		const [uri] = await file.createResumableUpload();

		context.metadata!['uri'] = uri;

		return context;
	}

	/**
	 * Append a chunk to the resumable-upload session.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param content - Chunk data.
	 * @param offset - Byte offset the chunk starts at.
	 * @param context - Upload context carrying the session `uri` and the CRC32C `hash` of the bytes uploaded so far.
	 * @returns The upload offset after this chunk, i.e. `offset` plus the bytes consumed from `content`.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		const file = this.file(this.fullPath(filepath));

		// 1. Continue the stored session as a partial upload: `offset` tells GCS where these bytes go, `resumeCRC32C`
		//    seeds the running checksum with the hash of the earlier chunks, and `contentLength` lets GCS finalise the
		//    object on its own once the last byte arrives, which is why `finishChunkedUpload` has nothing left to do
		const stream = file.createWriteStream({
			chunkSize: this.preferredChunkSize,
			uri: context.metadata!['uri'] as string,
			offset,
			isPartialUpload: true,
			resumeCRC32C: context.metadata!['hash'] as string,
			metadata: {
				contentLength: context.size || 0,
			},
		});

		// 2. The SDK emits the CRC32C of everything uploaded so far; keeping it in the context is what makes the next
		//    chunk resumable with an intact checksum
		stream.on('crc32c', (hash: string) => {
			context.metadata!['hash'] = hash;
		});

		// 3. Count the bytes as they pass, since the SDK does not report how much of the stream it consumed
		let bytesUploaded = offset || 0;

		content.on('data', (chunk: Buffer) => {
			bytesUploaded += chunk.length;
		});

		await pipeline(content, stream);

		return bytesUploaded;
	}

	/**
	 * Complete a chunked upload.
	 *
	 * Nothing to do: GCS finalises the object itself when the chunk that reaches `contentLength` lands, see
	 * {@link StorageDriverGcs.writeChunk}.
	 *
	 * @param _filepath - Final object path relative to the root; unused.
	 * @param _context - Upload context; unused.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {}

	/**
	 * Abort a chunked upload and remove whatever was stored under its path.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param _context - Upload context; unused, the object name is enough to clean up.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. GCS keeps no object for an unfinished session and lets the session expire on its own, so the only thing that
		//    can be left behind is a finished object under this path, which the plain delete removes
		await this.delete(filepath);
	}
}
