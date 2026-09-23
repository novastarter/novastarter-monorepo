import { PassThrough, pipeline, type Readable } from 'node:stream';
import { pipeline as pipelinePromise } from 'node:stream/promises';
import type {
	Bucket,
	CreateReadStreamOptions,
	CreateWriteStreamOptions,
	FileMetadata,
	GetFilesOptions,
	StorageOptions,
} from '@google-cloud/storage';
import { Storage } from '@google-cloud/storage';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import { toProviderCallError } from '@novastarter/errors';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	toListPrefix,
	toRelativePath,
	type TusDriver,
} from '@novastarter/storage';
import { type CallOptions, confinePath, joinPath, parseCallMethod, withTimeout } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';

/**
 * Smallest chunk size GCS accepts for a resumable upload: 256 KiB, `262_144` bytes.
 *
 * Every chunk but the last has to be a multiple of 256 KiB, so a smaller `chunkSize` would be rejected by the API on
 * the first PATCH.
 */
const MINIMUM_CHUNK_SIZE = 262_144;

/**
 * How long a {@link StorageDriverGcs.call} may take when the caller names no timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_GCS_CALL_TIMEOUT = 30_000;

/**
 * The root of the GCS JSON API a `call()` path is joined to, when the location names no `apiEndpoint`.
 *
 * @defaultValue `https://storage.googleapis.com`
 * @internal
 */
const GCS_API_ENDPOINT = 'https://storage.googleapis.com';

/**
 * The hosts a full URL given to {@link StorageDriverGcs.call} may point at, besides the configured `apiEndpoint`'s:
 * the application's credentials go only there.
 *
 * @internal
 */
const GCS_CALL_HOSTS = ['storage.googleapis.com'];

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
				/**
				 * Whether resumable uploads are switched on; when `false`, the chunked-upload methods refuse with an
				 * error naming the flag.
				 */
				enabled: boolean;
				/**
				 * Chunk size in bytes per upload request; a power of two of at least 256 KiB, validated whenever it is
				 * configured.
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
	 * Name of the bucket, put in place of `{bucket}` in a {@link StorageDriverGcs.call} path.
	 *
	 * @internal
	 */
	private readonly bucketName: string;

	/**
	 * Root of the JSON API a {@link StorageDriverGcs.call} path is joined to: the `apiEndpoint`, or GCS's own, with
	 * `/storage/v1` after it.
	 *
	 * @internal
	 */
	private readonly apiRoot: string;

	/**
	 * Chunk size handed to resumable uploads, taken from `tus.chunkSize` or {@link DEFAULT_CHUNK_SIZE}.
	 *
	 * @internal
	 */
	private readonly preferredChunkSize: number;

	/**
	 * Whether resumable uploads are switched on for this location, read from `tus.enabled`; only an explicit `false`
	 * disables them.
	 *
	 * @internal
	 */
	private readonly tusEnabled: boolean;

	/**
	 * Create a driver together with its client and bucket handle.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws Error when `tus.chunkSize` is configured with a value that is not a power of two of at least 256 KiB.
	 */
	constructor(config: StorageDriverGcsConfig) {
		const { bucket, root, tus, apiEndpoint } = config;

		// 1. Every operation targets the bucket, so a missing one is refused here rather than on the first request
		if (!bucket) {
			throw new Error('The gcs storage driver needs a "bucket"');
		}

		// 2. Normalise the root once without a leading slash: object names are not paths, and a leading `/` would become
		//    part of the name and produce objects nobody can find by the expected key
		//    `confinePath` also resolves `.` and `..` in the root, the way every key is resolved, so a root of `./media`
		//    strips from listed keys as `media` does, and a root of `/` means the top of the bucket
		this.root = root ? confinePath(root) : '';

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
		this.bucketName = bucket;

		// 5. The JSON API root for `call()`: the endpoint the client talks to, with `https` assumed like the SDK does
		//    for an endpoint without a scheme, so a raw request goes where the driver's own ones go
		const endpoint = apiEndpoint ?? GCS_API_ENDPOINT;
		const withScheme = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;

		this.apiRoot = `${withScheme.replace(/\/+$/, '')}/storage/v1`;

		// 6. The chunk size handed to resumable uploads: the configured value when one was given, the package default
		//    otherwise. `??` rather than `||`, so a configured `0` or `NaN` stays what it is and is caught by the
		//    validation below instead of being masked by the default
		this.preferredChunkSize = tus?.chunkSize ?? DEFAULT_CHUNK_SIZE;

		// 7. GCS requires resumable chunks to be multiples of 256 KiB; restricting to powers of two keeps every chunk
		//    aligned and rejects a misconfiguration here rather than on the first PATCH. The check runs on the
		//    configured value itself whenever one was given — `0` fails it for being below the minimum and `NaN` for
		//    not being a power of two — and it runs regardless of the `enabled` flag, because `writeChunk` hands the
		//    size to the SDK no matter what, so a value GCS would reject must not pass construction just because the
		//    flag is off
		if (tus?.chunkSize !== undefined && (tus.chunkSize < MINIMUM_CHUNK_SIZE || Math.log2(tus.chunkSize) % 1 !== 0)) {
			throw new Error('The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB');
		}

		// 8. An explicit `false` marks a location that does not serve resumable uploads; the chunked-upload methods
		//    read the flag and refuse rather than acting as if uploads were possible. An absent flag keeps the
		//    behaviour of every version before the option was honoured
		this.tusEnabled = tus?.enabled ?? true;
	}

	/**
	 * Resolve a caller path to the object name inside the bucket.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The object name with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. Pin the caller path under the root before joining: resolved against `/` first, a leading `..` has nothing
		//    to climb and is dropped by `confinePath`, so `../other/secret` cannot address an object outside the location. `joinPath`
		//    copes with an empty root and doubled slashes and always produces the forward slashes object names use
		return joinPath(this.root, confinePath(filepath));
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
	 * The SDK opens the object lazily, when the stream is first read, so a missing object is not known when this call
	 * answers: the stream errors instead, with the `StorageFileNotFoundError` every backend shares for a 404 and the
	 * SDK's error otherwise.
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

		// 2. The SDK's stream reports a missing object as a 404 error event once read; that event is translated into
		//    the error every backend shares on the stream handed out, so a consumer tells a missing object from a
		//    failed read the same way it does with the other drivers. The two are tied with `pipeline`, not `pipe`:
		//    a consumer that destroys the stream it was handed — a client gone mid-download — then destroys the SDK's
		//    stream and its HTTP response too, where `pipe` would only pause it and leave the socket open
		const source = this.file(this.fullPath(filepath)).createReadStream(streamOptions);
		const output = new PassThrough();

		source.on('error', (error: Error & { code?: number }) => {
			// 1. Only a 404 is translated; everything else passes through as the SDK reported it. Registered before
			//    `pipeline` adds its own handler, so the translated error is the one the consumer sees
			output.destroy(error.code === 404 ? new StorageFileNotFoundError({ filepath }, { cause: error }) : error);
		});

		pipeline(source, output, () => {
			// 1. The outcome already reached the consumer through `output`; nothing is left to report here
		});

		return output;
	}

	/**
	 * Store a stream as an object, replacing any existing one.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param content - Data to store.
	 * @param type - MIME type stored as the object's `Content-Type`; when omitted the SDK derives one from the object
	 * name's extension, the way the other backends fall back to their own default.
	 */
	async write(filepath: string, content: Readable, type?: string): Promise<void> {
		const file = this.file(this.fullPath(filepath));

		// 1. A single non-resumable request: it avoids the extra session round-trip, and resumable uploads have their own
		//    path through `writeChunk`
		const options: CreateWriteStreamOptions = { resumable: false };

		// 2. The type is recorded only when the caller gave one: an explicit `undefined` would replace the SDK's detection
		//    by file name with no type at all, and the object would be served as `application/octet-stream`
		if (type) {
			options.contentType = type;
		}

		const stream = file.createWriteStream(options);

		// 3. `pipeline` propagates errors from either side and closes both streams, unlike a bare `pipe`
		await pipelinePromise(content, stream);
	}

	/**
	 * Delete an object.
	 *
	 * @param filepath - Object path relative to the root.
	 * @throws The SDK error when the object does not exist or the request fails.
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
	 * @throws StorageFileNotFoundError when the object is missing.
	 * @throws The SDK error for any other failure, such as denied credentials or a timeout.
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

		// 2. The SDK types `size` as `string | number` and the JSON API sends a string, so it is converted into the
		//    number the storage contract expects; `updated` is an ISO timestamp, converted into the `Date` it expects.
		//    Both fields are optional in the SDK's types, and a metadata record missing either is a broken answer that
		//    is refused here rather than handed out as `NaN` / `Invalid Date` under the `Stat` type
		if (metadata.size === undefined || metadata.updated === undefined) {
			throw new Error(`No stat returned for file "${filepath}": the metadata has no size or updated time`);
		}

		return { size: Number(metadata.size), modified: new Date(metadata.updated) };
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
	 * @returns Object paths relative to the root; folder placeholders, the zero-byte objects whose name ends in `/`
	 * that the console creates for an empty "folder", are left out.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. Manual pagination in pages of 500: with `autoPaginate` the SDK would buffer the whole listing in memory
		//    before returning, while yielding per page keeps memory flat for large buckets
		let query: GetFilesOptions = {
			prefix: toListPrefix(this.fullPath(prefix), prefix),
			autoPaginate: false,
			maxResults: 500,
		};

		// 2. The SDK hands back the query for the next page, or nothing once the listing is exhausted
		while (query) {
			const [files, nextQuery] = await this.bucket.getFiles(query);

			// 3. Skip folder placeholders, as the S3 driver does: a name ending in `/` is a zero-byte marker the console
			//    creates for an empty "folder", not an object a caller can read, and listing it would hand a consumer a
			//    path that only exists on this backend. Strip the root and its slash from the rest, so callers get paths
			//    in the form they pass in
			for (const file of files) {
				if (file.name.endsWith('/')) continue;

				yield toRelativePath(this.root, file.name);
			}

			query = nextQuery as GetFilesOptions;
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// 1. Only the extensions the chunked-upload methods back are advertised: `creation` maps to
		//    `createChunkedUpload`, `termination` to `deleteChunkedUpload`, and `expiration` lets the server announce
		//    when GCS discards an unfinished resumable session. Checksum and concatenation are left out because a
		//    session verifies chunks only through its own running CRC32C and cannot be assembled from several uploads
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Refuse a chunked-upload call when the location has resumable uploads switched off.
	 *
	 * `tus.enabled: false` marks a location that does not serve resumable uploads; without the guard the
	 * chunked-upload methods would act as if uploads were possible and fail on the missing session state instead of
	 * saying why.
	 *
	 * @throws Error naming `tus.enabled` when resumable uploads are disabled.
	 * @internal
	 */
	private assertTusEnabled() {
		// 1. Only an explicit `false` disables uploads; an absent or `true` flag behaves as it always has
		if (this.tusEnabled === false) {
			throw new Error(
				'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
			);
		}
	}

	/**
	 * Open a GCS resumable-upload session for a chunked upload.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Client-supplied size and metadata; the metadata map is created when the client sent none.
	 * @returns The same context with the session `uri` stored in its metadata for the following calls.
	 * @throws Error naming `tus.enabled` when the location has resumable uploads disabled.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// 1. A location with resumable uploads switched off refuses the upload instead of opening a session it never
		//    agreed to serve
		this.assertTusEnabled();

		const file = this.file(this.fullPath(filepath));

		// 2. A client that sends no `Upload-Metadata` leaves the map undefined; it is created here, before the session is
		//    opened, so storing the URI below cannot fail and leak a session GCS already accepted
		const metadata = (context.metadata ??= {});

		// 3. The session URI is the only state GCS needs to accept further chunks; it lives in the context so a resumed
		//    upload on another process can continue the same session
		const [uri] = await file.createResumableUpload();

		metadata['uri'] = uri;

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
	 * @throws Error naming `tus.enabled` when the location has resumable uploads disabled.
	 * @throws Error when the context carries no session `uri`, meaning no upload was created by
	 * {@link StorageDriverGcs.createChunkedUpload}.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		// 1. A location with resumable uploads switched off refuses the chunk instead of failing on the missing session
		//    state, which would not say why
		this.assertTusEnabled();

		const file = this.file(this.fullPath(filepath));

		// 2. The map is read for the session state and written for the hash below; a context handed over without one
		//    gets an empty map rather than a TypeError
		const metadata = (context.metadata ??= {});

		// 3. The session URI is recorded by `createChunkedUpload`; a context without it means the calls arrived out of
		//    order, and an explicit error says so where the old non-null assertion handed the SDK `undefined` under a
		//    `string` type — the wording mirrors the S3 driver's missing-upload-id error
		const uri = metadata['uri'];

		if (uri === undefined || uri === null) {
			throw new Error(`Cannot write a chunk of "${filepath}": the context has no session uri`);
		}

		// 4. Continue the stored session as a partial upload: `offset` tells GCS where these bytes go, `resumeCRC32C`
		//    seeds the running checksum with the hash of the earlier chunks, and `contentLength` — sent only when the
		//    client declared a size — lets GCS finalise the object on its own once the last byte arrives, which is why
		//    `finishChunkedUpload` has nothing left to do. An unknown size must leave the key out entirely: `0` would
		//    read as a real total and finalise the object empty, while the upload library only falls back to a deferred
		//    `'*'` total when the key is absent
		const stream = file.createWriteStream({
			chunkSize: this.preferredChunkSize,
			uri,
			offset,
			isPartialUpload: true,
			resumeCRC32C: metadata['hash'] as string,
			metadata: {
				...(context.size !== undefined ? { contentLength: context.size } : {}),
			},
		});

		// 5. The SDK emits the CRC32C of everything uploaded so far; keeping it in the context is what makes the next
		//    chunk resumable with an intact checksum
		stream.on('crc32c', (hash: string) => {
			// 1. Written to the map the context carries, so the value survives into the next `writeChunk` call
			metadata['hash'] = hash;
		});

		// 6. Count the bytes as they pass, since the SDK does not report how much of the stream it consumed
		let bytesUploaded = offset || 0;

		content.on('data', (chunk: Buffer) => {
			// 1. Every chunk that flows through the pipeline is counted, whether or not the SDK has sent it yet
			bytesUploaded += chunk.length;
		});

		await pipelinePromise(content, stream);

		return bytesUploaded;
	}

	/**
	 * Make any request of the GCS JSON API with the location's credentials, bucket and a timeout — the way to what the
	 * storage contract does not cover: IAM policies, bucket metadata, lifecycle rules, notifications.
	 *
	 * `method` is the verb and the path under `/storage/v1` — `{bucket}` in it stands for the location's bucket — or
	 * a full URL on `storage.googleapis.com` or the configured `apiEndpoint`. The request carries an OAuth access token
	 * of the client's Application Default Credentials, the ones the driver's own requests use. The parameters are the
	 * query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise, unless `options.paramsIn` says; object names in
	 * a path are not placed under the location's root. The request is made once: a failed call is not retried.
	 *
	 * @typeParam T - What the API answers with; the caller knows it from the GCS documentation.
	 * @param method - The verb and path: `GET /b/{bucket}/iam`, `PATCH /b/{bucket}`.
	 * @param params - The query or the JSON body.
	 * @param options - A timeout over {@link DEFAULT_GCS_CALL_TIMEOUT} covering the token and the request, an abort
	 * signal, extra headers, where the parameters go.
	 * @returns The parsed JSON answer, else its text; `undefined` for an empty one.
	 * @throws ProviderCallError when GCS answers with an error status — its status and `{ error: { code, message } }`
	 * in `extensions`.
	 * @throws HitRateLimitError when GCS answers 429.
	 * @throws TimeoutError when the token and the request outlive the timeout.
	 * @throws Error when the method is malformed, its URL is not on a GCS host, or no access token can be had.
	 * @example
	 * ```ts
	 * const policy = await gcs.call<{ bindings: { role: string; members: string[] }[] }>('GET /b/{bucket}/iam');
	 *
	 * await gcs.call('PATCH /b/{bucket}', { versioning: { enabled: true } });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The verb and the URL; a full URL off the GCS hosts is refused here, before a token is even fetched
		const { verb, target } = parseCallMethod(method);

		const url = resolveCallUrl(this.apiRoot, target.replaceAll('{bucket}', encodeURIComponent(this.bucketName)), [
			...GCS_CALL_HOSTS,
		]);

		// 2. The token and the request under one deadline and the caller's signal: a slow metadata server counts
		//    against the timeout too. The request goes through `httpCall` rather than the SDK's client, whose errors
		//    carry the request's `Authorization` header, which ignores a per-request timeout and which retries a POST
		const timeout = options.timeout ?? DEFAULT_GCS_CALL_TIMEOUT;

		const response = await withTimeout(
			async (signal) => {
				// 1. The token of the client's credentials; the call stops here when the deadline passed meanwhile
				const token = await this.getCallToken();

				signal.throwIfAborted();

				// 2. The request under the same signal; its own deadline is the outer one, which fires first
				return httpCall({
					url,
					verb,
					params,
					paramsIn: options.paramsIn,
					headers: { authorization: `Bearer ${token}`, ...options.headers },
					timeout,
					signal,
				});
			},
			timeout,
			options.signal ? { signal: options.signal } : {},
		);

		// 3. An error status becomes the kit's error, a 429 the rate-limit one; GCS's `{ error: { code, message } }`
		//    body names the reason, and nothing of the request goes into it
		if (response.status >= 400) {
			throw toProviderCallError({
				provider: 'gcs',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}

	/**
	 * Get an OAuth access token of the client's credentials for {@link StorageDriverGcs.call}.
	 *
	 * The credentials library's errors carry the token request — a signed assertion, a refresh token — so one is never
	 * passed on: a plain error with its code takes its place.
	 *
	 * @returns The access token.
	 * @throws Error when no token can be had.
	 * @internal
	 */
	private async getCallToken(): Promise<string> {
		// 1. The auth client of the bucket's `Storage`, so the call authenticates exactly as the driver's own requests
		let token: string | null | undefined;

		try {
			token = await this.bucket.storage.authClient.getAccessToken();
		} catch (error) {
			// 1. Only the error's code — `ENOTFOUND`, `401` — is kept; its message and fields may hold the credentials
			const code = (error as { code?: unknown } | null)?.code;
			const safeCode = typeof code === 'string' || typeof code === 'number' ? ` (${String(code)})` : '';

			// eslint-disable-next-line preserve-caught-error -- the cause carries the token request
			throw new Error(`The gcs storage driver could not get an access token${safeCode}`);
		}

		// 2. Credentials that yield no token cannot authenticate the call; better said here than as a GCS 401
		if (!token) {
			throw new Error('The gcs storage driver could not get an access token');
		}

		return token;
	}

	/**
	 * Complete a chunked upload.
	 *
	 * Nothing to do: GCS finalises the object itself when the chunk that reaches `contentLength` lands, see
	 * {@link StorageDriverGcs.writeChunk}.
	 *
	 * @param _filepath - Final object path relative to the root; unused.
	 * @param _context - Upload context; unused.
	 * @throws Error naming `tus.enabled` when the location has resumable uploads disabled.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. A location with resumable uploads switched off refuses the call instead of silently "finishing" an
		//    upload it never accepted
		this.assertTusEnabled();
	}

	/**
	 * Abort a chunked upload and remove whatever was stored under its path.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param _context - Upload context; unused, the object name is enough to clean up.
	 * @throws Error naming `tus.enabled` when the location has resumable uploads disabled.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. A location with resumable uploads switched off refuses the termination instead of deleting whatever the
		//    path happens to name
		this.assertTusEnabled();

		// 2. GCS keeps no object for an unfinished session and lets the session expire on its own, so the only thing that
		//    can be left behind is a finished object under this path. `ignoreNotFound` answers the SDK's 404 for the far
		//    more common missing object with a no-op, the way the drivers whose delete never rejects do
		await this.file(this.fullPath(filepath)).delete({ ignoreNotFound: true });
	}
}
