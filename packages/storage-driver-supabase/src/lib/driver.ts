import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	type TusDriver,
} from '@novastarter/storage';
import { normalizePath } from '@novastarter/utils';
import { StorageClient } from '@supabase/storage-js';
import * as tus from 'tus-js-client';
import type { RequestInit } from 'undici';
import { fetch } from 'undici';
import { dirname } from './dirname.js';
import { FileReader } from './tus-source.js';

/**
 * Options accepted by {@link StorageDriverSupabase}.
 *
 * Either `projectId` or `endpoint` must be given: the first builds the hosted Supabase URL, the second points at a
 * self-hosted instance and wins when both are set.
 */
export type StorageDriverSupabaseConfig = {
	/** Storage bucket every operation targets. */
	bucket: string;
	/** Service-role key; sent as both `apikey` and bearer token, so the driver bypasses row-level security. */
	serviceRole: string;
	/** Hosted project id, expanded to `https://<projectId>.supabase.co/storage/v1`. */
	projectId?: string | undefined;
	/** Allows a custom Supabase endpoint for self-hosting; must include the `/storage/v1` path. */
	endpoint?: string | undefined;
	/** Path prefix every file is placed under; behaves like a root directory inside the bucket. */
	root?: string | undefined;
	/** Resumable-upload tuning. */
	tus?:
		| {
				/** Chunk size in bytes sent per TUS PATCH request. @defaultValue {@link DEFAULT_CHUNK_SIZE} */
				chunkSize?: number | undefined;
		  }
		| undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `supabase` has its
 * options checked against {@link StorageDriverSupabaseConfig}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		supabase: StorageDriverSupabaseConfig;
	}
}

/**
 * Storage driver backed by Supabase Storage.
 *
 * Plain operations go through `@supabase/storage-js`, except `read`, which fetches the authenticated object URL
 * directly so the body can be streamed and range requests work. Resumable (TUS) uploads are delegated to Supabase's
 * own TUS endpoint via `tus-js-client`, so no server-side part bookkeeping is needed: each incoming chunk is forwarded
 * as one TUS request and the upload URL is kept in the context for resuming.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverSupabase } from '@novastarter/storage-driver-supabase';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('supabase', StorageDriverSupabase);
 * storage.registerLocation('uploads', {
 * 	driver: 'supabase',
 * 	options: {
 * 		bucket: env.STORAGE_SUPABASE_BUCKET,
 * 		projectId: env.STORAGE_SUPABASE_PROJECT_ID,
 * 		serviceRole: env.STORAGE_SUPABASE_SERVICE_ROLE,
 * 	},
 * });
 * ```
 */
export class StorageDriverSupabase implements TusDriver {
	/**
	 * Options this instance was created with; `root` is already normalised and is an empty string when none was configured.
	 *
	 * @internal
	 */
	private config: StorageDriverSupabaseConfig & { root: string };

	/**
	 * Shared storage client; one per driver so its HTTP settings are reused across calls.
	 *
	 * @internal
	 */
	private client: StorageClient;

	/**
	 * Bucket handle every object operation goes through.
	 *
	 * @internal
	 */
	private bucket: ReturnType<StorageClient['from']>;

	/**
	 * Chunk size handed to `tus-js-client`, taken from `tus.chunkSize` or {@link DEFAULT_CHUNK_SIZE}.
	 *
	 * @internal
	 */
	private readonly preferredChunkSize: number;

	/**
	 * Create a driver together with its client and bucket handle.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws Error when neither `projectId` nor `endpoint` is given, or when `serviceRole` or `bucket` is missing.
	 */
	constructor(config: StorageDriverSupabaseConfig) {
		// 1. Normalise the root once without a leading slash: Supabase object names are not paths, and a leading `/`
		//    would become part of the name and produce objects nobody can find by the expected key
		this.config = {
			...config,
			root: normalizePath(config.root ?? '', { removeLeading: true }),
		};

		this.preferredChunkSize = this.config.tus?.chunkSize ?? DEFAULT_CHUNK_SIZE;

		// 2. Build the client and bucket up front, so configuration mistakes fail at construction instead of on the
		//    first request
		this.client = this.getClient();
		this.bucket = this.getBucket();
	}

	/**
	 * Base URL of the Storage API, either the configured endpoint or the hosted one derived from the project id.
	 *
	 * @internal
	 */
	private get endpoint() {
		// 1. A custom endpoint wins over the project id, so self-hosted instances are never routed to supabase.co
		return this.config.endpoint ?? `https://${this.config.projectId}.supabase.co/storage/v1`;
	}

	/**
	 * Build the storage client from the driver options.
	 *
	 * @returns A client authenticated with the service-role key.
	 * @throws Error when neither `projectId` nor `endpoint` is given, or when `serviceRole` is missing.
	 * @internal
	 */
	private getClient() {
		// 1. Without either the endpoint getter would produce `https://undefined.supabase.co`, so refuse early
		if (!this.config.projectId && !this.config.endpoint) {
			throw new Error('The supabase storage driver needs a "projectId" or an "endpoint"');
		}

		// 2. The service-role key is the only credential the driver supports; without it every request would be
		//    rejected as anonymous
		if (!this.config.serviceRole) {
			throw new Error('The supabase storage driver needs a "serviceRole"');
		}

		// 3. Supabase expects the key in both headers: `apikey` identifies the project, the bearer token authorises
		return new StorageClient(this.endpoint, {
			apikey: this.config.serviceRole,
			Authorization: `Bearer ${this.config.serviceRole}`,
		});
	}

	/**
	 * Resolve the bucket handle every object operation uses.
	 *
	 * @returns The bucket API bound to the configured bucket name.
	 * @throws Error when `bucket` is missing.
	 * @internal
	 */
	private getBucket() {
		// 1. `from('')` would not fail until the first request, so check the name here
		if (!this.config.bucket) {
			throw new Error('The supabase storage driver needs a "bucket"');
		}

		return this.client.from(this.config.bucket);
	}

	/**
	 * Resolve a caller path to the object name inside the bucket.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The object name with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		const path = join(this.config.root, filepath);

		// 1. With no root and an empty path `join` yields `.`, but Supabase expects an empty string for the current
		//    directory and would otherwise look for a literal `.` object
		if (path === '.') return '';

		// 2. Normalising turns the platform separators `join` may produce into the forward slashes object names use
		return normalizePath(path);
	}

	/**
	 * Build the URL of the authenticated download endpoint for an object.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns URL under `object/authenticated`, which serves private objects to a bearer-authenticated request.
	 * @internal
	 */
	private getAuthenticatedUrl(filepath: string) {
		// 1. `object/authenticated` rather than `object/public`: the bucket may be private, and the bearer token in the
		//    request is what grants access either way
		return `${this.endpoint}/${join('object/authenticated', this.config.bucket, this.fullPath(filepath))}`;
	}

	/**
	 * Build the URL of the TUS creation endpoint.
	 *
	 * @returns The resumable-upload endpoint of the Storage API.
	 * @internal
	 */
	private getResumableUrl() {
		// 1. The bucket and object name are not part of the URL: Supabase reads them from the TUS metadata instead
		return `${this.endpoint}/upload/resumable`;
	}

	/**
	 * Stream an object's contents.
	 *
	 * The storage client only offers `download`, which buffers the whole object, so the authenticated endpoint is
	 * fetched directly and its body is streamed.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns The response body as a Node stream.
	 * @throws Error when the response is an error status or carries no body.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		const requestInit: RequestInit = { method: 'GET' };

		// 1. The service-role bearer token is what lets the `authenticated` endpoint serve private objects
		requestInit.headers = {
			Authorization: `Bearer ${this.config.serviceRole}`,
		};

		// 2. Translate the range into the HTTP header form: an omitted bound becomes an empty side, so `end` alone
		//    yields `bytes=-N`, which the server reads as the last N bytes rather than the first
		if (range) {
			requestInit.headers['Range'] = `bytes=${range.start ?? ''}-${range.end ?? ''}`;
		}

		const response = await fetch(this.getAuthenticatedUrl(filepath), requestInit);

		// 3. An error status or a missing body means there is nothing to stream; the body is cancelled first because
		//    an unread body holds its connection open
		if (response.status >= 400 || !response.body) {
			await response.body?.cancel();

			throw new Error(`No stream returned for file "${filepath}"`);
		}

		// 4. `fetch` returns a Web stream; the rest of the storage layer works with Node readables
		return Readable.fromWeb(response.body);
	}

	/**
	 * Look an object up by listing its parent folder with the file name as the search term.
	 *
	 * Supabase has no metadata endpoint for a single object, so a filtered listing limited to one result is the
	 * cheapest way to fetch size and modification time.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns The listing entry, or `undefined` when nothing matched.
	 * @throws The storage error when the listing itself fails, since that says nothing about the object.
	 * @internal
	 */
	private async find(filepath: string) {
		let rootPath = join(this.config.root, dirname(filepath));

		// 1. With no root and a bare file name `join` yields `.`, but Supabase expects an empty string for the current
		//    directory
		if (rootPath === '.') rootPath = '';

		const rootFolder = normalizePath(rootPath);

		// 2. Search by the base name only: the API filters within the given folder, so the folder part goes into the
		//    prefix and the name into `search`
		const { data, error } = await this.bucket.list(rootFolder, {
			search: basename(filepath),
			limit: 1,
		});

		// 3. A failed lookup is not an empty one; surfacing the error keeps callers from acting on a wrong answer
		if (error) throw error;

		return data[0];
	}

	/**
	 * Read an object's size and last-modified time.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when the object is missing.
	 * @throws The storage error when the lookup itself fails.
	 */
	async stat(filepath: string): Promise<Stat> {
		const file = await this.find(filepath);

		// 1. An empty listing is the only way Supabase reports a missing object; it becomes the error every backend
		//    shares
		if (!file) {
			throw new StorageFileNotFoundError({ filepath });
		}

		// 2. Metadata is null for folders, so fall back to zero values rather than throwing on a folder entry
		return {
			size: file.metadata?.['contentLength'] ?? 0,
			modified: new Date(file.metadata?.['lastModified'] || 0),
		};
	}

	/**
	 * Check whether an object is present.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns `true` when the listing returned the object, `false` otherwise.
	 * @throws The storage error when the lookup fails, since that says nothing about the object.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. Reuse the filtered listing behind `stat`; an entry is proof of existence
		return (await this.find(filepath)) !== undefined;
	}

	/**
	 * Move an object to a new name within the bucket.
	 *
	 * @param src - Current object path.
	 * @param dest - Path to move the object to.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. Supabase offers a native move, so unlike S3 this is a single request
		await this.bucket.move(this.fullPath(src), this.fullPath(dest));
	}

	/**
	 * Copy an object to a new name within the bucket.
	 *
	 * @param src - Object to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		// 1. The bucket API copies server-side, so the object never passes through this process
		await this.bucket.copy(this.fullPath(src), this.fullPath(dest));
	}

	/**
	 * Upload a stream as an object, replacing any existing content.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param content - Data to store.
	 * @param type - MIME type stored as the object's `Content-Type`; an empty string when omitted.
	 * @throws Error wrapping the storage error when the upload fails.
	 */
	async write(filepath: string, content: Readable, type?: string): Promise<void> {
		// 1. `upsert` makes a write over an existing name replace it, as the driver contract expects; `duplex: 'half'`
		//    is required by `fetch` for a streamed request body; the one-hour cache header mirrors the Supabase default
		const { error } = await this.bucket.upload(this.fullPath(filepath), content, {
			contentType: type ?? '',
			cacheControl: '3600',
			upsert: true,
			duplex: 'half',
		});

		// 2. The client reports failures as a return value; rethrow with the path so the caller knows which file failed
		if (error) {
			throw new Error(`Error uploading file "${filepath}"`, { cause: error });
		}
	}

	/**
	 * Remove an object.
	 *
	 * @param filepath - Object path relative to the root.
	 */
	async delete(filepath: string): Promise<void> {
		// 1. `remove` is a batch API; a one-element list is the single-object form
		await this.bucket.remove([this.fullPath(filepath)]);
	}

	/**
	 * Enumerate object paths under a prefix.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root, folders descended recursively.
	 */
	list(prefix = ''): AsyncIterable<string> {
		// 1. Resolve the prefix once against the root; the generator works with full object names from here on
		const fullPrefix = this.fullPath(prefix);
		return this.listGenerator(fullPrefix);
	}

	/**
	 * Walk the bucket listing for a full prefix, yielding files and descending into folders.
	 *
	 * The Supabase API only returns the directories and files directly within the queried location (called prefix in
	 * their API) matching the search query. Directories can be identified by the id being null.
	 *
	 * Since it's unknown whether the last part of the prefix param is a directory, a file or part of a directory or
	 * file name, the first query will be the largest common denominator (the parent directory part of the prefix) and
	 * the results then filtered with the remaining part of the query.
	 *
	 * This can lead to the following outcomes:
	 *
	 * 1. The full prefix is a file and is split up into parentdir/filename, the API is queried with
	 *    `{ prefix: parentdir, search: filename }` and returns one result `{ name: filename, id: "..." }`. The filename
	 *    is yielded in that case.
	 * 2. The full prefix is a directory and is split up into parentdir/dir, the API is queried with
	 *    `{ prefix: parentdir, search: dir }` and returns one result `{ name: dir, id: null }` and importantly, not the
	 *    contents of the directory. Then the contents of the directory must be listed recursively by calling this
	 *    function with the prefix and a trailing "/".
	 *    2.1. The prefix ends with a "/", the API is queried with `{ prefix: prefix, search: "" }` and returns all
	 *         files and directories within the prefix, which are yielded and recursively listed.
	 * 3. Special case of 1. and 2.: The prefix is part of a filename/directory name and could result in more than one
	 *    result that all match the search query. The API is queried with `{ prefix: parentdir, search: part of
	 *    filename }` and returns all files and directories in parentdir that match the search query. Filenames are
	 *    yielded and directories are recursively listed.
	 *
	 * @param prefix - Full object-name prefix, root included.
	 * @returns Object paths relative to the root.
	 * @internal
	 */
	async *listGenerator(prefix: string): AsyncIterable<string> {
		const limit = 1000;
		let offset = 0;
		let itemCount;

		// 1. Split the prefix into the folder to query and the name fragment to search for, as described above; a
		//    trailing slash means the whole folder is wanted
		const isDirectory = prefix.endsWith('/');
		const prefixDirectory = isDirectory ? prefix : dirname(prefix);
		const search = isDirectory ? '' : (prefix.split('/').pop() ?? '');

		// 2. Page through the listing with an offset; a full page means there may be more, a short page ends the loop
		do {
			const { data, error } = await this.bucket.list(prefixDirectory, {
				limit,
				offset,
				search,
			});

			// 3. A failed page ends the listing with what was yielded so far, matching the upstream driver
			if (!data || error) {
				break;
			}

			itemCount = data.length;
			offset += itemCount;

			for (const item of data) {
				// 4. The API only returns the entry name, so the full path is rebuilt from the queried folder
				const filePath = normalizePath(join(prefixDirectory, item.name));

				if (item.id !== null) {
					// 5. A file: strip the root (and its trailing slash) so callers get paths in the form they pass in
					yield filePath.substring(this.config.root ? this.config.root.length + 1 : 0);
				} else {
					// 6. A folder has no id; descend with a trailing slash so the recursive call lists its contents
					yield* this.listGenerator(`${filePath}/`);
				}
			}
		} while (itemCount === limit);
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 */
	get tusExtensions(): string[] {
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start a resumable upload.
	 *
	 * Nothing is created on the Supabase side yet: the TUS upload is created lazily by the first `writeChunk`, which
	 * records the upload URL in the context.
	 *
	 * @param _filepath - Final object path relative to the root; unused.
	 * @param context - Client-supplied size and metadata.
	 * @returns The context unchanged.
	 */
	async createChunkedUpload(_filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// 1. Creating the TUS upload here would need a request without a body; `tus-js-client` does creation and the
		//    first chunk in one go, so the context is passed through untouched
		return context;
	}

	/**
	 * Forward one TUS chunk to Supabase's own TUS endpoint.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param context - Context carrying the total `size`, the client metadata and, after the first chunk, the
	 * `upload-url` to resume from.
	 * @returns The new upload offset: `offset` plus the bytes Supabase acknowledged.
	 * @throws The `tus-js-client` error when the chunk is rejected.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		let bytesUploaded = offset || 0;

		// 1. Supabase reads the target from the TUS metadata rather than the URL; the content type falls back to a
		//    generic image type because the endpoint rejects an empty one
		const metadata = {
			bucketName: this.config.bucket,
			objectName: this.fullPath(filepath),
			contentType: context.metadata!['type'] ?? 'image/png',
			cacheControl: '3600',
		};

		await new Promise((resolve, reject) => {
			// 2. The custom file reader feeds `tus-js-client` the chunk as a one-shot source, so the library sends
			//    exactly this chunk instead of trying to read the whole file. `x-upsert` lets a re-upload replace the
			//    object; retries are disabled because the TUS server in front of this driver already retries. The size
			//    is only passed when known: an explicit `undefined` is not an absent key to the library's option types
			const upload = new tus.Upload(content, {
				endpoint: this.getResumableUrl(),
				fileReader: new FileReader(),
				headers: {
					Authorization: `Bearer ${this.config.serviceRole}`,
					'x-upsert': 'true',
				},
				metadata,
				chunkSize: this.preferredChunkSize,
				...(context.size === undefined ? {} : { uploadSize: context.size }),
				retryDelays: null,
				onError(error) {
					reject(error);
				},
				// 3. Resolve after the first chunk completes: this call only ever carries one chunk, so waiting for
				//    `onSuccess` would block until the whole upload finished
				onChunkComplete: function (chunkSize) {
					bytesUploaded += chunkSize;

					resolve(null);
				},
				onSuccess() {
					resolve(null);
				},
				// 4. Remember the upload URL Supabase assigned on creation: it is the only handle for appending later
				//    chunks, and the context is what the TUS server hands back on every following call
				onUploadUrlAvailable() {
					if (!context.metadata!['upload-url']) {
						context.metadata!['upload-url'] = upload.url;
					}
				},
			});

			// 5. On every chunk after the first, resume the existing upload instead of creating a new one
			if (context.metadata!['upload-url']) {
				upload.resumeFromPreviousUpload({
					size: context.size!,
					creationTime: context.metadata!['creation_date'] as string,
					metadata,
					uploadUrl: context.metadata!['upload-url'],
				} as any);
			}

			upload.start();
		});

		return bytesUploaded;
	}

	/**
	 * Complete a resumable upload.
	 *
	 * Supabase assembles the object itself once the final chunk arrives, so there is nothing to do here.
	 *
	 * @param _filepath - Final object path relative to the root; unused.
	 * @param _context - Upload context; unused.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {}

	/**
	 * Abort a resumable upload by removing whatever sits under its name.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param _context - Upload context; unused, since Supabase expires unfinished TUS uploads on its own.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. Only the object under the final name is removed; an unfinished TUS upload has no handle the driver could
		//    abort, and Supabase expires it on its own
		await this.delete(filepath);
	}
}
