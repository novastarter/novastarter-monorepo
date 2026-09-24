import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
	AccountSASPermissions,
	type BlobClient,
	type BlobGetPropertiesResponse,
	BlobServiceClient,
	ContainerClient,
	generateAccountSASQueryParameters,
	SASProtocol,
	StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { InvalidConfigError, InvalidPayloadError, toProviderCallError } from '@novastarter/errors';
import {
	type CallOptions,
	type CallResponse,
	type HttpApi,
	type HttpCallFetch,
	type HttpCallResponse,
	parseCallMethod,
	request,
} from '@novastarter/http';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	toListPrefix,
	toRelativePath,
	type TusDriver,
} from '@novastarter/storage';
import { confinePath, joinPath } from '@novastarter/utils';

/**
 * Largest chunk an append blob accepts per `Append Block` request.
 *
 * Azure caps a single appended block at 100 MiB; a larger chunk would be rejected by the service, so the constructor
 * refuses a configured chunk size above this limit up front.
 *
 * @defaultValue 100 MiB.
 * @see https://learn.microsoft.com/en-us/rest/api/storageservices/append-block#remarks
 */
const MAXIMUM_CHUNK_SIZE = 104_857_600;

/**
 * How long the account SAS a {@link StorageDriverAzure.call} signs its request with stays valid, in milliseconds.
 *
 * Long enough for a request that runs to its timeout, short enough that a SAS which leaks is useless soon after.
 *
 * @defaultValue 5 minutes.
 * @internal
 */
const CALL_SAS_LIFETIME = 5 * 60_000;

/**
 * Metadata key under which a resumable upload's context carries the id of its staging blob.
 *
 * @defaultValue `'azure-staging-id'`
 * @internal
 */
const STAGING_ID_KEY = 'azure-staging-id';

/**
 * Shape of a staging id: 12 lowercase hex characters, the random suffix of a `<name>.<id>.tmp` staging blob.
 *
 * @internal
 */
const STAGING_ID_PATTERN = /^[0-9a-f]{12}$/;

/**
 * Name suffix of a staging blob, which `list()` leaves out; the same shape the local driver gives its staging files.
 *
 * @internal
 */
const STAGING_SUFFIX_PATTERN = /\.[0-9a-f]{12}\.tmp$/;

/**
 * Options accepted by {@link StorageDriverAzure}.
 *
 * Authentication is by shared key only: `accountName` and `accountKey` are turned into a
 * `StorageSharedKeyCredential`, so every request is signed with the account key.
 */
export type StorageDriverAzureConfig = {
	/** Blob container every operation targets. */
	containerName: string;
	/** Storage account name; also used to derive the default endpoint. */
	accountName: string;
	/** Shared account key requests are signed with. */
	accountKey: string;
	/** Path prefix every blob is placed under; behaves like a root directory inside the container. */
	root?: string | undefined;
	/**
	 * Custom blob service endpoint, e.g. for Azurite or sovereign clouds.
	 *
	 * @defaultValue `https://<accountName>.blob.core.windows.net`
	 */
	endpoint?: string | undefined;
	/** Resumable-upload tuning. */
	tus?:
		| {
				/** Whether resumable uploads are switched on; only then is `chunkSize` validated. */
				enabled: boolean;
				/** Chunk size in bytes appended per TUS PATCH request; must be positive and not exceed {@link MAXIMUM_CHUNK_SIZE}. */
				chunkSize?: number | undefined;
		  }
		| undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `azure` has its
 * options checked against {@link StorageDriverAzureConfig}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		azure: StorageDriverAzureConfig;
	}
}

/**
 * Storage driver backed by Azure Blob Storage.
 *
 * Plain files are stored as block blobs through `@azure/storage-blob`. Resumable (TUS) uploads are staged in a
 * separate append blob, `<name>.<id>.tmp`: each incoming chunk becomes one `Append Block` request, so no part
 * bookkeeping is needed, and finishing the upload copies the staging blob over the final name server-side. The final
 * blob of such an upload is an append blob, and its size is bounded by the service's 50,000 appended blocks, one per
 * chunk.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverAzure } from '@novastarter/storage-driver-azure';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('azure', StorageDriverAzure);
 * storage.registerLocation('uploads', {
 * 	driver: 'azure',
 * 	options: {
 * 		containerName: env.STORAGE_AZURE_CONTAINER_NAME,
 * 		accountName: env.STORAGE_AZURE_ACCOUNT_NAME,
 * 		accountKey: env.STORAGE_AZURE_ACCOUNT_KEY,
 * 	},
 * });
 * ```
 */
export class StorageDriverAzure implements TusDriver {
	/**
	 * The location's `ContainerClient` of `@azure/storage-blob` — the SDK's own API, with the location's shared-key
	 * credential and endpoint — for what {@link StorageDriverAzure.call} does not cover: every write, SAS URLs, leases,
	 * streamed uploads and downloads; `client.getBlockBlobClient(name)` and its kin reach single blobs. Every blob
	 * operation of the driver goes through it too.
	 *
	 * Blob names given to it are not placed under the location's root.
	 *
	 * @example
	 * ```ts
	 * const { client } = useStorage().location('azure') as StorageDriverAzure;
	 * await client.setMetadata({ owner: 'media' });
	 * await client.getBlockBlobClient('report.pdf').setAccessTier('Cool');
	 * ```
	 */
	readonly client: ContainerClient;

	/**
	 * Shared-key credential the service client signs requests with.
	 *
	 * @internal
	 */
	private signedCredentials: StorageSharedKeyCredential;

	/**
	 * Blob service endpoint a {@link StorageDriverAzure.call} path is joined to: the configured one or the account's own.
	 *
	 * @internal
	 */
	private readonly endpoint: string;

	/**
	 * Name of the container, put in place of `{container}` in a {@link StorageDriverAzure.call} path.
	 *
	 * @internal
	 */
	private readonly containerName: string;

	/**
	 * Normalised root prefix without a leading slash; an empty string when none was configured.
	 *
	 * @internal
	 */
	private root: string;

	/**
	 * Largest chunk in bytes one `writeChunk` appends, taken from `tus.chunkSize` when resumable uploads are enabled
	 * and from the append-block limit otherwise.
	 *
	 * @internal
	 */
	private readonly maximumChunkSize: number;

	/**
	 * Create a driver together with its credential and container handle.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws InvalidConfigError when `accountName`, `accountKey` or `containerName` is missing, or when resumable
	 * uploads are enabled with a `chunkSize` that is not positive or exceeds {@link MAXIMUM_CHUNK_SIZE}.
	 */
	constructor(config: StorageDriverAzureConfig) {
		// Refused here: the SDK would only fail on the first request, with an error that does not name the option
		for (const option of ['accountName', 'accountKey', 'containerName'] as const) {
			if (!config[option]) {
				throw new InvalidConfigError({
					reason: `The azure storage driver needs ${option.startsWith('a') ? 'an' : 'a'} "${option}"`,
				});
			}
		}

		// The SDK signs every request with the credential, so there is no per-call auth step
		this.signedCredentials = new StorageSharedKeyCredential(config.accountName, config.accountKey);

		// A custom endpoint wins over the derived one, so emulators and non-public clouds are never routed to
		// `blob.core.windows.net`
		this.endpoint = config.endpoint ?? `https://${config.accountName}.blob.core.windows.net`;
		this.containerName = config.containerName;

		const service = new BlobServiceClient(this.endpoint, this.signedCredentials);

		this.client = service.getContainerClient(config.containerName);

		// No leading slash: blob names are not paths, and a leading `/` would become part of the name and produce blobs
		// nobody can find by the expected key. `confinePath` also resolves `.` and `..` in the root, the way every key
		// is resolved, so a root of `./media` strips from listed keys as `media` does, and a root of `/` means the top
		// of the container
		this.root = config.root ? confinePath(config.root) : '';

		// Fail at construction rather than on the first chunk: the service rejects appended blocks above the limit, and
		// a misconfigured size would otherwise only surface mid-upload.
		// https://learn.microsoft.com/en-us/rest/api/storageservices/append-block?tabs=microsoft-entra-id#remarks
		if (config.tus?.enabled && config.tus.chunkSize && config.tus.chunkSize > MAXIMUM_CHUNK_SIZE) {
			throw new InvalidConfigError({ reason: 'The azure storage driver got a "tus.chunkSize" above 100 MiB' });
		}

		// A zero, negative or NaN size would be kept as the per-chunk bound and refuse every chunk that arrives; the
		// check is written as `!(size > 0)`, the NaN-safe form the S3 driver uses, since comparisons never catch NaN
		if (config.tus?.enabled && config.tus.chunkSize !== undefined && !(config.tus.chunkSize > 0)) {
			throw new InvalidConfigError({ reason: 'The azure storage driver got a "tus.chunkSize" below 1 byte' });
		}

		// One TUS chunk becomes one `Append Block` request, so the bound `writeChunk` enforces per chunk is the
		// configured size when resumable uploads are on — validated above to stay within the service limit — and the
		// service limit itself otherwise
		this.maximumChunkSize = config.tus?.enabled && config.tus.chunkSize ? config.tus.chunkSize : MAXIMUM_CHUNK_SIZE;
	}

	/**
	 * Resolve a caller path to the blob name inside the container.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The blob name with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// The caller path is pinned under the root before joining: resolved against `/` first, a leading `..` has
		// nothing to climb and is dropped by `confinePath`, so `../other/secret` cannot address a blob outside the
		// location. `joinPath` always produces the forward slashes blob names use, whatever the platform's separator
		return joinPath(this.root, confinePath(filepath));
	}

	/**
	 * Stream a blob's contents.
	 *
	 * @param filepath - Blob path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns The download body as a Node stream.
	 * @throws StorageFileNotFoundError when the blob does not exist.
	 * @throws Error when the SDK returns no body to stream.
	 * @throws The SDK error for any other failure.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		// The SDK takes an offset and a count rather than a closed range, so `end` is turned into a count from the
		// start (inclusive, hence the `+ 1`); with no `end` the count stays undefined and the rest of the blob is read.
		// Presence, not truthiness: `end: 0` asks for the first byte, not for the whole blob
		let readableStreamBody: NodeJS.ReadableStream | undefined;

		// A 404 becomes the error every backend shares, so a caller tells a missing blob from a denied or failed read;
		// anything else says nothing about the blob and is rethrown
		try {
			({ readableStreamBody } = await this.client
				.getBlobClient(this.fullPath(filepath))
				.download(range?.start, range?.end !== undefined ? range.end - (range.start ?? 0) + 1 : undefined));
		} catch (error) {
			if ((error as { statusCode?: number })?.statusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// `readableStreamBody` is only set in Node (browsers get `blobBody` instead), so its absence here means there
		// is nothing to stream
		if (!readableStreamBody) {
			throw new Error(`The azure storage driver got no stream for file "${filepath}"`);
		}

		return readableStreamBody as Readable;
	}

	/**
	 * Upload a stream as a block blob, replacing any existing content.
	 *
	 * With no `type` given the blob defaults to `application/octet-stream` by design, so typeless bytes stay
	 * downloadable without the service having to guess a format.
	 *
	 * @param filepath - Blob path relative to the root.
	 * @param content - Data to store.
	 * @param type - MIME type stored as the blob's `Content-Type`; `application/octet-stream` when omitted.
	 */
	async write(filepath: string, content: Readable, type = 'application/octet-stream'): Promise<void> {
		const blockBlobClient = this.client.getBlockBlobClient(this.fullPath(filepath));

		// `uploadStream` splits the stream into blocks and commits them, so the size need not be known in advance
		await blockBlobClient.uploadStream(content as Readable, undefined, undefined, {
			blobHTTPHeaders: { blobContentType: type },
		});
	}

	/**
	 * Remove a blob.
	 *
	 * @param filepath - Blob path relative to the root.
	 */
	async delete(filepath: string): Promise<void> {
		// `deleteIfExists` rather than `delete`, so removing a blob that is already gone is a no-op instead of a 404
		await this.client.getBlockBlobClient(this.fullPath(filepath)).deleteIfExists();
	}

	/**
	 * Read a blob's size and last-modified time.
	 *
	 * @param filepath - Blob path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when the service answers 404.
	 * @throws The SDK error for any other failure.
	 */
	async stat(filepath: string): Promise<Stat> {
		let props: BlobGetPropertiesResponse;

		// `getProperties` is a HEAD request, so the metadata comes back without downloading the body. A 404 is the one
		// answer that confirms the blob is missing; anything else says nothing about the blob and is rethrown
		try {
			props = await this.client.getBlobClient(this.fullPath(filepath)).getProperties();
		} catch (error) {
			if ((error as { statusCode?: number })?.statusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// Both fields are optional in the SDK's types; a properties response without one is a broken answer and is
		// refused here rather than handed out as `undefined` under the non-optional `Stat` type
		if (props.contentLength === undefined || props.lastModified === undefined) {
			throw new Error(`The azure storage driver got no size or modified time for file "${filepath}"`);
		}

		return {
			size: props.contentLength,
			modified: props.lastModified,
		};
	}

	/**
	 * Check whether a blob is present.
	 *
	 * @param filepath - Blob path relative to the root.
	 * @returns `true` when the blob exists, `false` otherwise.
	 * @throws The SDK error when the lookup itself fails, since that says nothing about the blob.
	 */
	async exists(filepath: string): Promise<boolean> {
		// The SDK only answers `false` for a missing blob; any other failure keeps travelling so callers never act on a
		// wrong answer
		return await this.client.getBlockBlobClient(this.fullPath(filepath)).exists();
	}

	/**
	 * Move a blob to a new name within the container.
	 *
	 * @param src - Current blob path.
	 * @param dest - Path to move the blob to.
	 */
	async move(src: string, dest: string): Promise<void> {
		// Blob Storage has no rename
		await this.copy(src, dest);
		await this.client.getBlockBlobClient(this.fullPath(src)).deleteIfExists();
	}

	/**
	 * Copy a blob to a new name within the container.
	 *
	 * @param src - Blob to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		const source = this.client.getBlockBlobClient(this.fullPath(src));
		const target = this.client.getBlobClient(this.fullPath(dest));

		// The copy runs server-side and asynchronously. The target is addressed as a plain blob and replaced when its
		// type differs, since a TUS upload leaves an append blob and `write()` a block blob, and Azure refuses to copy
		// one onto the other
		await copyBlobReplacing(target, source.url);
	}

	/**
	 * Enumerate blob paths under a prefix.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Blob paths relative to the root; folder placeholder blobs, the zero-byte markers whose name ends in `/`
	 * that ADLS Gen2 and several upload tools create, are left out.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// A flat listing walks every blob under the prefix regardless of virtual folders, which is what a recursive
		// listing expects
		const blobs = this.client.listBlobsFlat({
			prefix: toListPrefix(this.fullPath(prefix), prefix),
		});

		// Folder placeholder blobs are skipped, as the S3 and GCS drivers do: a name ending in `/` is a zero-byte
		// marker an empty "folder" is created with, not an object a caller can read, and listing it would hand a
		// consumer a path that only exists on this backend. The root is stripped so callers get paths in the form they
		// pass in
		for await (const blob of blobs) {
			if ((blob.name as string).endsWith('/')) continue;

			// A resumable upload in flight stages its bytes in a `<name>.<id>.tmp` blob; it is not an object a caller
			// stored, so it is left out the way the local driver leaves out its staging files
			if (STAGING_SUFFIX_PATTERN.test(blob.name as string)) continue;

			yield toRelativePath(this.root, blob.name as string);
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// `expiration` lets the server announce when an unfinished append blob may be discarded. Checksum and
		// concatenation are left out because an append blob can neither verify a chunk before it lands nor be assembled
		// from several uploads
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Resolve the staging blob a resumable upload writes its chunks to.
	 *
	 * The staging blob is a `<name>.<id>.tmp` sibling of the target, so `list()` hides it; the id lives in the context
	 * under {@link STAGING_ID_KEY}.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param context - Context returned by {@link StorageDriverAzure.createChunkedUpload}.
	 * @returns The staging blob name inside the container.
	 * @throws StorageFileNotFoundError when the context carries no valid staging id, meaning the upload was never
	 * created by this driver.
	 * @internal
	 */
	private stagingPath(filepath: string, context: ChunkedUploadContext) {
		const stagingId = context.metadata?.[STAGING_ID_KEY];

		// Only the exact shape `createChunkedUpload` generates passes, so a context that lost the id, or one carrying a
		// crafted value, can never point the upload at another blob
		if (typeof stagingId !== 'string' || !STAGING_ID_PATTERN.test(stagingId)) {
			throw new StorageFileNotFoundError({ filepath });
		}

		return `${this.fullPath(filepath)}.${stagingId}.tmp`;
	}

	/**
	 * Start a resumable upload by creating an empty staging append blob next to the target.
	 *
	 * The target itself is not touched until {@link StorageDriverAzure.finishChunkedUpload}, so a blob already stored
	 * under the path keeps its content while chunks are uploaded and survives an upload that is abandoned, terminated
	 * or expired. Finishing is what replaces it, and that step is not atomic.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param context - Client-supplied size and metadata.
	 * @returns The same context with the staging id stored in its metadata under {@link STAGING_ID_KEY}; the metadata
	 * map is created when the context has none.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// The context is what the TUS server hands back on every later call, so the staging id goes into its metadata
		// and the driver keeps no state; a POST without `Upload-Metadata` arrives with no map at all
		const metadata = (context.metadata ??= {});

		// A random id per upload keeps two concurrent uploads of the same path from sharing one staging blob; it
		// overwrites any client-sent value under the same key
		metadata[STAGING_ID_KEY] = randomBytes(6).toString('hex');

		// An append blob must exist before blocks can be appended. The name is new, so `create` never meets an old blob
		// whose length would make the first append at position 0 fail
		await this.client.getAppendBlobClient(this.stagingPath(filepath, context)).create();

		return context;
	}

	/**
	 * Append one TUS chunk to the upload's staging append blob.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param context - Context carrying the staging id.
	 * @returns The new upload offset: `offset` plus the bytes appended.
	 * @throws StorageFileNotFoundError when the context carries no valid staging id.
	 * @throws InvalidPayloadError when the chunk exceeds the size configured as `tus.chunkSize`, or the append-block
	 * limit when no size was configured.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		// Chunks go to the staging blob, never to the target, which keeps its previous content until
		// `finishChunkedUpload` starts copying the staging blob over it
		const client = this.client.getAppendBlobClient(this.stagingPath(filepath, context));

		let bytesUploaded = offset || 0;
		let chunkSize = 0;

		const chunks: Buffer[] = [];

		// `appendBlock` needs the exact byte length up front, which a stream cannot give, so the chunk is buffered. The
		// moment it crosses the bound the stream is destroyed, so an oversized chunk is refused while it is still
		// arriving rather than after the whole of it has been buffered
		for await (let chunk of content) {
			if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);

			chunkSize += chunk.length;
			bytesUploaded += chunk.length;
			chunks.push(chunk);

			// One TUS chunk becomes one `Append Block` request, so a chunk above the bound is refused here, with the
			// size named, instead of as a service error mid-upload
			if (chunkSize > this.maximumChunkSize) {
				throw new InvalidPayloadError({
					reason: `The chunk of ${chunkSize} bytes exceeds the chunk size limit of ${this.maximumChunkSize} bytes`,
				});
			}
		}

		const chunk = Buffer.concat(chunks);

		// The service rejects a zero-length append
		if (chunk.length > 0) {
			// Append blobs always append at the current end, so a PATCH whose response was lost and which the TUS
			// client resends at the same offset would otherwise append the same bytes a second time, silently growing
			// the blob past its declared size. Pinned to the offset the chunk claims, the service answers 412 instead
			// of corrupting the upload
			await client.appendBlock(chunk, chunk.length, { conditions: { appendPosition: offset } });
		}

		return bytesUploaded;
	}

	/**
	 * Make a read of the Blob service REST API with the location's account, endpoint and a timeout — the way to what
	 * the storage contract does not cover: service properties and stats, container metadata and ACLs, blob tags and
	 * properties; and a `DELETE`. Every write goes through {@link StorageDriverAzure.client}.
	 *
	 * `method` is a `GET`, `HEAD` or `DELETE` and the path from the blob endpoint — a `{name}` in it is filled from the
	 * parameter of that name, which is then not sent again, and `{container}` without one stands for the location's
	 * container — or a full URL on that endpoint's host. The request is authorised with an account SAS signed for it
	 * alone — scoped to the read, delete, list and tag permissions these operations need, so a URL that leaks cannot
	 * write — and valid for a few minutes, since the SDK keeps its signing pipeline to itself; operations an account
	 * SAS cannot authorise are refused by Azure. The parameters go into the query, where the Blob service takes them.
	 * Blob names in a path are not placed under the location's root.
	 *
	 * @typeParam T - What the service answers with, most often XML text; the caller knows it from Azure's documentation.
	 * @param method - The verb and path: `GET /?restype=service&comp=properties`, `HEAD /{container}/a.jpg`.
	 * @param params - The query.
	 * @param options - A timeout over the default 30 s, an abort signal, extra headers.
	 * @returns The status, the headers — the `x-ms-*` properties of a HEAD — and the answer: parsed JSON, else its
	 * text — XML for most operations; `undefined` for an empty one.
	 * @throws ProviderCallError when Azure answers with an error status — its status and XML answer, without the SAS,
	 * in `extensions`.
	 * @throws HitRateLimitError when Azure answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the verb is not a `GET`, `HEAD` or `DELETE`, the method is malformed, a placeholder is left
	 * unfilled, its URL is not on the endpoint's host, or Azure cannot be reached.
	 * @example
	 * ```ts
	 * const { data: xml } = await azure.call<string>('GET /', { restype: 'service', comp: 'properties' });
	 *
	 * const { headers } = await azure.call('HEAD /{container}/a.jpg');
	 *
	 * await azure.call('GET /{container}/{blob}', { blob: 'media/a.jpg', comp: 'tags' }); // media%2Fa.jpg
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// Reads only: a write's body — XML, a blob — is the SDK's job, and a read's parameters belong in the query
		const { verb } = parseCallMethod(method);

		if (verb !== 'GET' && verb !== 'HEAD' && verb !== 'DELETE') {
			throw new Error(`The azure call "${method}" is not a GET, HEAD or DELETE; writes go through the client`);
		}

		// A SAS for this request only — signed locally, it leaves the process only with the request, after the host
		// check: read, delete, list and tag, the permissions the operations above need — a list for `comp=list`, a tag
		// for `comp=tags`, never write or create, so a SAS that leaks cannot change anything — and a lifetime of
		// minutes. The start lies a minute back, so a service clock slightly behind still accepts it
		const now = Date.now();

		const sas = generateAccountSASQueryParameters(
			{
				startsOn: new Date(now - 60_000),
				expiresOn: new Date(now + CALL_SAS_LIFETIME),
				permissions: AccountSASPermissions.parse('rdlt'),
				services: 'b',
				resourceTypes: 'sco',
				...(new URL(this.endpoint).protocol === 'https:' ? { protocol: SASProtocol.Https } : {}),
			},
			this.signedCredentials,
		);

		// A refusal loses the signature, should Azure quote it, and a failure to reach Azure its cause, which may quote
		// the signed URL
		const api: HttpApi = {
			provider: 'azure',
			baseUrl: this.endpoint,
			headers: { 'x-ms-version': sas.version },
			placeholders: { container: this.containerName },
			query: Object.fromEntries(new URLSearchParams(sas.toString()).entries()),
			fetch: unreachableWithoutCause,
			refuse: (response, refused) => refuseRedacted(response, refused, sas.signature),
		};

		return request<T>(api, method, params, options);
	}

	/**
	 * Complete a resumable upload by copying its staging blob over the target, then removing the staging blob.
	 *
	 * The copy runs server-side within the account (`Copy Blob`), so no byte passes through the process and the size is
	 * bounded only by the append blob limit of 50,000 appended blocks, one per chunk. The finished blob is an append
	 * blob, the type of its source. Azure copies onto an existing blob only when it has the same type, so a block blob
	 * already under the path, such as one `write()` stored, is deleted just before the copy; an append blob from an
	 * earlier upload is copied over in place.
	 *
	 * The copy is not atomic. While it is pending the target can be a committed blob of zero length, and a copy that
	 * fails leaves it empty; when the target was deleted for the second copy, a failed finish leaves the path without
	 * a blob. The previous content is therefore not guaranteed to survive a failed finish. The staging blob is removed
	 * only after the copy succeeds, so on any failure it stays in place and calling this method again with the same
	 * context retries the finish.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param context - Context carrying the staging id.
	 * @throws StorageFileNotFoundError when the context carries no valid staging id, or the staging blob is gone.
	 * @throws The SDK error for any other failure of the copy or of removing the staging blob; the staging blob is kept
	 * then, but the target may be empty or missing.
	 * @see https://learn.microsoft.com/en-us/rest/api/storageservices/copy-blob
	 */
	async finishChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const staging = this.client.getAppendBlobClient(this.stagingPath(filepath, context));
		const target = this.client.getBlobClient(this.fullPath(filepath));

		// The copy is not atomic: while it is pending the target may read as empty, and a failed copy leaves it empty.
		// A missing staging blob means the upload is unknown or already finished
		try {
			// A target of another blob type, a block blob from `write()`, is removed and the copy repeated. If this
			// second copy fails, the old target is already gone and the path stays empty; the error propagates before
			// the staging blob is removed, so it survives and a retried finish copies it onto the now free path
			await copyBlobReplacing(target, staging.url);
		} catch (error) {
			const { statusCode } = (error ?? {}) as { statusCode?: number };

			if (statusCode === 404) throw new StorageFileNotFoundError({ filepath }, { cause: error });

			throw error;
		}

		// The staging blob is removed only now that the target holds its bytes, so every failure above keeps it for a
		// retry
		await staging.deleteIfExists();
	}

	/**
	 * Abort a resumable upload by removing its staging blob.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param context - Context carrying the staging id.
	 * @throws StorageFileNotFoundError when the context carries no valid staging id.
	 */
	async deleteChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		// The target was never written by this upload, so whatever it held before stays in place. `deleteIfExists`
		// keeps a termination of an upload whose blob is already gone from failing
		await this.client.getAppendBlobClient(this.stagingPath(filepath, context)).deleteIfExists();
	}
}

/**
 * Copy a blob of the same account onto a target and wait until the service reports the copy done.
 *
 * @param target - Blob the copy is written to.
 * @param sourceUrl - URL of the source blob; the shared-key credential of the driver authorises it within the account.
 * @throws The SDK error when the copy cannot start or fails.
 * @internal
 */
async function copyBlob(target: BlobClient, sourceUrl: string): Promise<void> {
	// `Copy Blob` may finish asynchronously, so the poller is awaited instead of returning while it is pending
	const poller = await target.beginCopyFromURL(sourceUrl);
	await poller.pollUntilDone();
}

/**
 * Copy a blob of the same account onto a target, replacing a target of another blob type.
 *
 * Azure copies onto an existing blob only when it has the source's type and answers 409 `InvalidBlobType` otherwise:
 * a TUS upload leaves an append blob while `write()` leaves a block blob. The target is then deleted and the copy
 * repeated. This is not atomic: if the second copy fails, the old target is already gone.
 *
 * @param target - Blob the copy is written to.
 * @param sourceUrl - URL of the source blob; the shared-key credential of the driver authorises it within the account.
 * @throws The SDK error when either copy cannot start or fails, or when removing the mismatched target fails.
 * @internal
 */
async function copyBlobReplacing(target: BlobClient, sourceUrl: string): Promise<void> {
	try {
		await copyBlob(target, sourceUrl);
	} catch (error) {
		// Only a blob type mismatch is recoverable here; any other failure, such as a copy still pending on the target,
		// propagates untouched so the target is not lost
		const { statusCode, code } = (error ?? {}) as { statusCode?: number; code?: string };

		if (statusCode !== 409 || code !== 'InvalidBlobType') throw error;

		// The mismatched target is removed so the second copy creates the path afresh with the source's type
		await target.deleteIfExists();
		await copyBlob(target, sourceUrl);
	}
}

/**
 * The global `fetch` for {@link StorageDriverAzure.call}, whose failure to reach Azure is reported without its cause:
 * the details of a network error may quote the signed URL, SAS included.
 *
 * @param url - The URL, SAS included.
 * @param init - The request.
 * @returns The response.
 * @throws Error naming only the network error's code; the abort reason when the signal aborted.
 * @internal
 */
const unreachableWithoutCause: HttpCallFetch = async (url, { body, ...init }) => {
	try {
		return await fetch(url, body === undefined ? init : { ...init, body });
	} catch (error) {
		if (init.signal.aborted) throw init.signal.reason;

		// Only the code survives, such as `ENOTFOUND` or `ECONNRESET`
		const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
		const suffix = typeof code === 'string' ? ` (${code})` : '';

		// eslint-disable-next-line preserve-caught-error -- the cause may quote the signed URL
		throw new Error(`The azure call could not reach the service${suffix}`);
	}
};

/**
 * Turn an error status of Azure into the kit's error, the SAS signature struck from the answer should Azure quote it,
 * so no error or log line ever carries a working SAS.
 *
 * @param response - Azure's answer.
 * @param method - The call's method, for the error.
 * @param signature - The signature of the call's SAS.
 * @returns The error for a status outside 2xx; `undefined` for a success.
 * @internal
 */
const refuseRedacted = (response: HttpCallResponse, method: string, signature: string): Error | undefined => {
	if (response.status >= 200 && response.status < 300) return undefined;

	return toProviderCallError({
		provider: 'azure',
		method,
		status: response.status,
		body: typeof response.body === 'string' ? redact(response.body, signature) : response.body,
		headers: response.headers,
	});
};

/**
 * Strike a SAS signature from a text, in its plain and its URL-encoded form.
 *
 * @param text - The text, an error answer of Azure.
 * @param signature - The signature.
 * @returns The text without the signature.
 * @internal
 */
const redact = (text: string, signature: string): string => {
	// Both forms, since Azure may quote the URL it was sent as well as the decoded value
	if (!signature) return text;

	return text.replaceAll(signature, '[redacted]').replaceAll(encodeURIComponent(signature), '[redacted]');
};
