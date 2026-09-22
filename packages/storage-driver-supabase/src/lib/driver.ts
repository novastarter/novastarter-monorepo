import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	toListPrefix,
	toRelativePath,
	type TusDriver,
} from '@novastarter/storage';
import { confinePath, joinPath, normalizePath } from '@novastarter/utils';
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
			root: confinePath(config.root ?? ''),
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
	 * @returns The URL every object, listing and TUS request is built on, without a trailing slash.
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
		// 1. Confine the caller path under the root before joining, as every other driver does: a leading `..` is
		//    dropped, so `../other/secret` cannot address an object outside the location, and a leading slash goes,
		//    so an empty root leaves a clean object name. `joinPath` answers `''` for no root and no path, which is
		//    what Supabase expects for the top of the bucket
		return joinPath(this.config.root, confinePath(filepath));
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
		//    request is what grants access either way. Each name segment is percent-encoded: a raw `?` would read as the
		//    start of the query string and a raw `#` as the fragment, so an unencoded name would make the endpoint
		//    address a different object than the caller named. `joinPath` keeps the forward slashes an HTTP URL needs,
		//    the way the object names are built
		const encodedPath = this.fullPath(filepath)
			.split('/')
			.map((segment) => encodeURIComponent(segment))
			.join('/');

		return `${this.endpoint}/${joinPath('object/authenticated', this.config.bucket, encodedPath)}`;
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
	 * @throws StorageFileNotFoundError when Supabase answers 404.
	 * @throws Error naming the HTTP status for any other error status, with the response body as `cause` when
	 * Supabase sent one.
	 * @throws Error when a successful response carries no body to stream.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		const requestInit: RequestInit = { method: 'GET' };

		// 1. Supabase expects the key in both headers, the way `getClient` authenticates the storage-js client:
		//    `apikey` identifies the project, the bearer token is what lets the `authenticated` endpoint serve
		//    private objects
		requestInit.headers = {
			Authorization: `Bearer ${this.config.serviceRole}`,
			apikey: this.config.serviceRole,
		};

		// 2. Translate the range into the HTTP header form: an omitted start is `0` — `{ end }` alone asks for the
		//    first bytes up to `end`, where `bytes=-N` would mean the last N bytes — and an omitted end is left open
		if (range) {
			requestInit.headers['Range'] = `bytes=${range.start ?? 0}-${range.end ?? ''}`;
		}

		const response = await fetch(this.getAuthenticatedUrl(filepath), requestInit);

		// 3. A 404 becomes the error every backend shares, so a caller tells a missing object from a denied or failed
		//    read; the body is cancelled first because an unread body holds its connection open
		if (response.status === 404) {
			await response.body?.cancel();

			throw new StorageFileNotFoundError({ filepath });
		}

		// 4. Any other error status is a failed read, not a missing stream: the status stays in the message so a
		//    denied, throttled or failed read can be told apart, and the body, which carries Supabase's own reason, is
		//    read as the cause — reading it also releases the connection
		if (response.status >= 400) {
			const reason = await response.text().catch(() => '');

			throw new Error(`Couldn't read file "${filepath}" (${response.status})`, reason ? { cause: reason } : undefined);
		}

		// 5. A successful answer without a body has nothing to stream; nothing to cancel either
		if (!response.body) {
			throw new Error(`No stream returned for file "${filepath}"`);
		}

		// 6. `fetch` returns a Web stream; the rest of the storage layer works with Node readables
		return Readable.fromWeb(response.body);
	}

	/**
	 * Look an object up by listing its parent folder with the file name as the search term.
	 *
	 * Supabase has no metadata endpoint for a single object, so a filtered listing is the cheapest way to fetch size
	 * and modification time. The `search` filter is a case-insensitive prefix match, not an exact one, and folders are
	 * listed before files, so the pages are walked until the entry whose name equals the requested one and that is a
	 * file — a folder has no id — turns up.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns The listing entry of the object, or `undefined` when no file of exactly that name exists.
	 * @throws Error wrapping the storage error when the listing itself fails, since that says nothing about the
	 * object.
	 * @internal
	 */
	private async find(filepath: string) {
		// 1. The folder is the full object name without its last segment, confined under the root like the name
		//    itself; `joinPath` with `..` drops that segment and answers `''` at the top of the bucket. The split is on
		//    `/` alone — `node:path`'s `basename` would use the platform separator, and an object name containing a
		//    backslash is one name in Supabase, not a path
		const name = this.fullPath(filepath);
		const rootFolder = joinPath(name, '..');
		const fileName = name.split('/').pop() ?? '';

		const limit = 100;
		let offset = 0;
		let itemCount;

		// 2. Search by the base name only: the API filters within the given folder, so the folder part goes into the
		//    prefix and the name into `search`. The filter also matches `name.bak` or `NAME`, so a page can hold other
		//    entries first; a full page means the exact one may still follow, a short page ends the walk
		do {
			const { data, error } = await this.bucket.list(rootFolder, {
				search: fileName,
				limit,
				offset,
			});

			// 3. A failed lookup is not an empty one; surfacing the error, with the path the caller asked for, keeps
			//    callers from acting on a wrong answer
			if (error || !data) {
				throw new Error(`Error looking up file "${filepath}"`, error ? { cause: error } : undefined);
			}

			// 4. Only the entry with exactly the requested name counts, and only as a file: a folder of the same name
			//    has no id and no metadata, and answering for it would report a missing object as present
			const file = data.find((item) => item.id !== null && item.name === fileName);

			if (file) {
				return file;
			}

			itemCount = data.length;
			offset += itemCount;
		} while (itemCount === limit);

		return undefined;
	}

	/**
	 * Read an object's size and last-modified time.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when no file of exactly that name exists; a folder of that name does not count.
	 * @throws Error when the listing entry carries no size or modification time, the way the other drivers refuse a
	 * broken metadata answer.
	 * @throws Error wrapping the storage error when the lookup itself fails.
	 */
	async stat(filepath: string): Promise<Stat> {
		const file = await this.find(filepath);

		// 1. A listing without a file of exactly that name is the only way Supabase reports a missing object; it
		//    becomes the error every backend shares
		if (!file) {
			throw new StorageFileNotFoundError({ filepath });
		}

		// 2. `find` only returns file entries, which carry their size and modification time in the listing metadata; an
		//    entry without those fields is a broken answer from the API and is refused here — the way the S3, GCS and
		//    Azure drivers refuse a stat response missing its fields — rather than handed out as `0` / the epoch under
		//    the `Stat` type
		if (file.metadata?.['contentLength'] === undefined || file.metadata?.['lastModified'] === undefined) {
			throw new Error(`No stat returned for file "${filepath}": the listing entry has no size or modification time`);
		}

		return {
			size: file.metadata['contentLength'],
			modified: new Date(file.metadata['lastModified']),
		};
	}

	/**
	 * Check whether an object is present.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns `true` when a file of exactly that name exists, `false` otherwise; a folder of that name does not
	 * count.
	 * @throws Error wrapping the storage error when the lookup fails, since that says nothing about the object.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. Reuse the exact lookup behind `stat`; an entry is proof of existence
		return (await this.find(filepath)) !== undefined;
	}

	/**
	 * Move an object to a new name within the bucket.
	 *
	 * @param src - Current object path.
	 * @param dest - Path to move the object to.
	 * @throws Error wrapping the storage error when the move fails.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. Supabase offers a native move, so unlike S3 this is a single request; the client reports a failure as a
		//    return value rather than throwing, so it is thrown here — a move that did not happen must not read as done
		const { error } = await this.bucket.move(this.fullPath(src), this.fullPath(dest));

		if (error) {
			throw new Error(`Error moving file "${src}" to "${dest}"`, { cause: error });
		}
	}

	/**
	 * Copy an object to a new name within the bucket.
	 *
	 * @param src - Object to copy.
	 * @param dest - Path of the copy.
	 * @throws Error wrapping the storage error when the copy fails.
	 */
	async copy(src: string, dest: string): Promise<void> {
		// 1. The bucket API copies server-side, so the object never passes through this process; a failure comes back
		//    as a return value and is thrown, so a copy that did not happen does not read as done
		const { error } = await this.bucket.copy(this.fullPath(src), this.fullPath(dest));

		if (error) {
			throw new Error(`Error copying file "${src}" to "${dest}"`, { cause: error });
		}
	}

	/**
	 * Upload a stream as an object, replacing any existing content.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param content - Data to store.
	 * @param type - MIME type stored as the object's `Content-Type`; a generic binary type when omitted, since the
	 * endpoint rejects an empty one.
	 * @throws Error wrapping the storage error when the upload fails.
	 */
	async write(filepath: string, content: Readable, type?: string): Promise<void> {
		// 1. `upsert` makes a write over an existing name replace it, as the driver contract expects; `duplex: 'half'`
		//    is required by `fetch` for a streamed request body; the one-hour cache header mirrors the Supabase default
		const { error } = await this.bucket.upload(this.fullPath(filepath), content, {
			contentType: type ?? 'application/octet-stream',
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
	 * @throws Error wrapping the storage error when the removal fails.
	 */
	async delete(filepath: string): Promise<void> {
		// 1. `remove` is a batch API; a one-element list is the single-object form. A failure comes back as a return
		//    value and is thrown, so an object that is still there does not read as deleted
		const { error } = await this.bucket.remove([this.fullPath(filepath)]);

		if (error) {
			throw new Error(`Error deleting file "${filepath}"`, { cause: error });
		}
	}

	/**
	 * Enumerate object paths under a prefix.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root, folders descended recursively.
	 */
	list(prefix = ''): AsyncIterable<string> {
		// 1. Resolve the prefix once against the root; the generator works with full object names from here on. The
		//    whole root, or a caller folder, keeps its trailing slash, so the generator lists that folder rather than
		//    searching its parent for names starting with it — `media` would match `media-archive` too
		return this.listGenerator(toListPrefix(this.fullPath(prefix), prefix));
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
	 * @throws Error wrapping the storage error when a page of the listing fails, naming the full prefix queried.
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

			// 3. A failed page must not end the listing as if it were complete: a caller that removes what is no longer
			//    listed would wipe data on a transient error, so the failure is thrown like every other operation of
			//    this driver. A page without data and without an error breaks the client's own contract and is
			//    treated the same way rather than read as an empty prefix
			if (error || !data) {
				throw new Error(`Error listing prefix "${prefix}"`, error ? { cause: error } : undefined);
			}

			itemCount = data.length;
			offset += itemCount;

			for (const item of data) {
				// 4. The API only returns the entry name, so the full path is rebuilt from the queried folder
				const filePath = normalizePath(join(prefixDirectory, item.name));

				if (item.id !== null) {
					// 5. A file: strip the root (and its trailing slash) so callers get paths in the form they pass in
					yield toRelativePath(this.config.root, filePath);
				} else {
					// 6. A folder has no id; descend with a trailing slash so the recursive call lists its contents
					yield* this.listGenerator(`${filePath}/`);
				}
			}
		} while (itemCount === limit);
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// 1. Exactly what Supabase's own TUS endpoint supports: uploads are created lazily on the first chunk,
		//    `deleteChunkedUpload` terminates them and Supabase expires unfinished ones itself; concatenation and
		//    checksums are not offered, so advertising them would promise what the backend cannot honour
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
	 * @throws Error when the chunk exceeds the size configured as `tus.chunkSize`.
	 * @throws The `tus-js-client` error when the chunk is rejected.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		let bytesUploaded = offset || 0;

		// 1. The map may arrive absent from a POST without `Upload-Metadata`; it is created rather than crashing with a
		//    TypeError, so the upload state below always has a place to go
		const contextMetadata = (context.metadata ??= {});

		// 2. Supabase reads the target from the TUS metadata rather than the URL; the content type falls back to a
		//    generic binary type because the endpoint rejects an empty one. `contentType` is the standardised key and
		//    wins; `type` is still read as the legacy name older clients send
		const metadata = {
			bucketName: this.config.bucket,
			objectName: this.fullPath(filepath),
			contentType: contextMetadata['contentType'] ?? contextMetadata['type'] ?? 'application/octet-stream',
			cacheControl: '3600',
		};

		const chunks: Buffer[] = [];
		let chunkSize = 0;

		// 3. Buffer the chunk as it streams in, counting bytes on the way: the one-shot source handed to
		//    `tus-js-client` below serves exactly one slice, so a chunk larger than the configured size would be
		//    truncated to the first request and crash the library's upload loop. The bound is checked on the running
		//    total, so an oversized chunk is refused while it is still arriving rather than after the whole of it has
		//    been buffered, and before any upload starts
		for await (let chunk of content) {
			if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);

			chunkSize += chunk.length;
			chunks.push(chunk);

			// 4. The TUS server agreed to send at most the configured size per request; the wording mirrors the other
			//    drivers, so a caller sees the same error whatever backend serves the location
			if (chunkSize > this.preferredChunkSize) {
				throw new Error(
					`The chunk of ${chunkSize} bytes exceeds the chunk size limit of ${this.preferredChunkSize} bytes`,
				);
			}
		}

		// 4. `tus-js-client` reports through callbacks, so the one chunk is wrapped in a promise the callbacks settle
		await new Promise((resolve, reject) => {
			// 1. The custom file reader feeds `tus-js-client` the buffered chunk as a one-shot source, so the library
			//    sends exactly this chunk instead of trying to read the whole file. `x-upsert` lets a re-upload
			//    replace the object; retries are disabled because the TUS server in front of this driver already
			//    retries. The size is only passed when known: an explicit `undefined` is not an absent key to the
			//    library's option types
			const upload = new tus.Upload(Readable.from(chunks, { objectMode: false }), {
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
				onChunkComplete(chunkSize) {
					// 1. Resolve after the first chunk completes: this call only ever carries one chunk, so waiting for
					//    `onSuccess` would block until the whole upload finished
					bytesUploaded += chunkSize;

					resolve(null);
				},
				onSuccess() {
					resolve(null);
				},
				onUploadUrlAvailable() {
					// 1. Remember the upload URL Supabase assigned on creation: it is the only handle for appending
					//    later chunks, and the context is what the TUS server hands back on every following call. The
					//    creation date is recorded next to it because resuming an upload reads both, the way
					//    tus-js-client keeps them together
					if (!contextMetadata['upload-url']) {
						contextMetadata['upload-url'] = upload.url;
						contextMetadata['creation_date'] = new Date().toString();
					}
				},
			});

			// 2. On every chunk after the first, resume the existing upload instead of creating a new one; the literal
			//    is the tus-js-client previous-upload contract, with an empty storage key and no parallel URLs because
			//    this driver never stores uploads in a urlStorage and uploads a single stream. The size is `null` when
			//    the client still defers the length, which is the contract's own marker for an unknown total
			if (contextMetadata['upload-url']) {
				const previousUpload: tus.PreviousUpload = {
					size: context.size ?? null,
					creationTime: contextMetadata['creation_date'] as string,
					metadata,
					uploadUrl: contextMetadata['upload-url'],
					urlStorageKey: '',
					parallelUploadUrls: null,
				};

				upload.resumeFromPreviousUpload(previousUpload);
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
