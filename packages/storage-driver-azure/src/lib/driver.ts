import type { Readable } from 'node:stream';
import {
	AccountSASPermissions,
	type BlobGetPropertiesResponse,
	BlobServiceClient,
	ContainerClient,
	generateAccountSASQueryParameters,
	SASProtocol,
	StorageSharedKeyCredential,
} from '@azure/storage-blob';
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
import { resolveCallUrl, toQueryString } from '@novastarter/utils/node';

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
 * How long a {@link StorageDriverAzure.call} may take when the caller names no timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_AZURE_CALL_TIMEOUT = 30_000;

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
 * Plain files are stored as block blobs through `@azure/storage-blob`. Resumable (TUS) uploads use an append blob
 * under the final blob name: each incoming chunk becomes one `Append Block` request, so no part bookkeeping is needed
 * and the blob is complete as soon as the last chunk lands.
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
	 * Container handle every blob operation goes through.
	 *
	 * @internal
	 */
	private containerClient: ContainerClient;

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
	 * @throws Error when `accountName`, `accountKey` or `containerName` is missing, or when resumable uploads are
	 * enabled with a `chunkSize` that is not positive or exceeds {@link MAXIMUM_CHUNK_SIZE}.
	 */
	constructor(config: StorageDriverAzureConfig) {
		// 1. Refuse a missing credential or container here: the SDK would only fail on the first request, with an error
		//    that does not name the option
		for (const option of ['accountName', 'accountKey', 'containerName'] as const) {
			if (!config[option]) {
				throw new Error(`The azure storage driver needs ${option.startsWith('a') ? 'an' : 'a'} "${option}"`);
			}
		}

		// 2. Build the credential once; the SDK signs every request with it, so there is no per-call auth step
		this.signedCredentials = new StorageSharedKeyCredential(config.accountName, config.accountKey);

		// 3. A custom endpoint wins over the derived one, so emulators and non-public clouds are never routed to
		//    `blob.core.windows.net`
		this.endpoint = config.endpoint ?? `https://${config.accountName}.blob.core.windows.net`;
		this.containerName = config.containerName;

		const client = new BlobServiceClient(this.endpoint, this.signedCredentials);

		this.containerClient = client.getContainerClient(config.containerName);

		// 4. Strip the leading slash from the root: blob names are not paths, and a leading `/` would become part of
		//    the name and produce blobs nobody can find by the expected key
		//    `confinePath` also resolves `.` and `..` in the root, the way every key is resolved, so a root of `./media`
		//    strips from listed keys as `media` does, and a root of `/` means the top of the bucket
		this.root = config.root ? confinePath(config.root) : '';

		// 5. Fail at construction rather than on the first chunk: the service rejects appended blocks above the limit,
		//    and a misconfigured size would otherwise only surface mid-upload
		//    https://learn.microsoft.com/en-us/rest/api/storageservices/append-block?tabs=microsoft-entra-id#remarks
		if (config.tus?.enabled && config.tus.chunkSize && config.tus.chunkSize > MAXIMUM_CHUNK_SIZE) {
			throw new Error('The azure storage driver got a "tus.chunkSize" above 100 MiB');
		}

		// 6. A zero, negative or NaN size would be kept as the per-chunk bound and refuse every chunk that arrives; the
		//    check is written as `!(size > 0)`, the NaN-safe form the S3 driver uses, since comparisons never catch NaN
		if (config.tus?.enabled && config.tus.chunkSize !== undefined && !(config.tus.chunkSize > 0)) {
			throw new Error('The azure storage driver got a "tus.chunkSize" below 1 byte');
		}

		// 7. One TUS chunk becomes one `Append Block` request, so the bound `writeChunk` enforces per chunk is the
		//    configured size when resumable uploads are on — validated above to stay within the service limit — and the
		//    service limit itself otherwise
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
		// 1. Pin the caller path under the root before joining: resolved against `/` first, a leading `..` has nothing
		//    to climb and is dropped by `confinePath`, so `../other/secret` cannot address a blob outside the location. `joinPath`
		//    always produces the forward slashes blob names use, whatever the platform's separator
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

		// 1. The SDK takes an offset and a count rather than a closed range, so `end` is turned into a count from the
		//    start (inclusive, hence the `+ 1`); with no `end` the count stays undefined and the rest of the blob is
		//    read. Presence, not truthiness: `end: 0` asks for the first byte, not for the whole blob
		let readableStreamBody: NodeJS.ReadableStream | undefined;

		// 2. A 404 is the error every backend shares, so a caller tells a missing blob from a denied or failed read;
		//    anything else says nothing about the blob and is rethrown
		try {
			({ readableStreamBody } = await this.containerClient
				.getBlobClient(this.fullPath(filepath))
				.download(range?.start, range?.end !== undefined ? range.end - (range.start ?? 0) + 1 : undefined));
		} catch (error) {
			if ((error as { statusCode?: number })?.statusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 3. `readableStreamBody` is only set in Node (browsers get `blobBody` instead), so its absence here means there
		//    is nothing to stream
		if (!readableStreamBody) {
			throw new Error(`No stream returned for file "${filepath}"`);
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
		const blockBlobClient = this.containerClient.getBlockBlobClient(this.fullPath(filepath));

		// 1. `uploadStream` splits the stream into blocks and commits them, so the size need not be known in advance;
		//    buffer size and concurrency are left at the SDK defaults
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
		// 1. `deleteIfExists` rather than `delete`, so removing a blob that is already gone is a no-op instead of a 404
		await this.containerClient.getBlockBlobClient(this.fullPath(filepath)).deleteIfExists();
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

		// 1. `getProperties` is a HEAD request, so the metadata comes back without downloading the body. A 404 is the
		//    one answer that confirms the blob is missing; it becomes the error every backend shares, anything else says
		//    nothing about the blob and is rethrown
		try {
			props = await this.containerClient.getBlobClient(this.fullPath(filepath)).getProperties();
		} catch (error) {
			if ((error as { statusCode?: number })?.statusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 2. Both fields are optional in the SDK's types; a properties response without one is a broken answer and is
		//    refused here rather than handed out as `undefined` under the non-optional `Stat` type
		if (props.contentLength === undefined || props.lastModified === undefined) {
			throw new Error(`No stat returned for file "${filepath}"`);
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
		// 1. The SDK only answers `false` for a missing blob; any other failure keeps travelling so callers never act on
		//    a wrong answer
		return await this.containerClient.getBlockBlobClient(this.fullPath(filepath)).exists();
	}

	/**
	 * Move a blob to a new name within the container.
	 *
	 * @param src - Current blob path.
	 * @param dest - Path to move the blob to.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. Blob Storage has no rename, so a move is a server-side copy followed by deleting the source
		await this.copy(src, dest);
		await this.containerClient.getBlockBlobClient(this.fullPath(src)).deleteIfExists();
	}

	/**
	 * Copy a blob to a new name within the container.
	 *
	 * @param src - Blob to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		const source = this.containerClient.getBlockBlobClient(this.fullPath(src));
		const target = this.containerClient.getBlockBlobClient(this.fullPath(dest));

		// 1. The copy runs server-side and asynchronously, so the poller is awaited until the service reports it done
		//    rather than returning while the copy is still pending
		const poller = await target.beginCopyFromURL(source.url);
		await poller.pollUntilDone();
	}

	/**
	 * Enumerate blob paths under a prefix.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Blob paths relative to the root; folder placeholder blobs, the zero-byte markers whose name ends in `/`
	 * that ADLS Gen2 and several upload tools create, are left out.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. A flat listing walks every blob under the prefix regardless of virtual folders, which is what a recursive
		//    listing expects
		const blobs = this.containerClient.listBlobsFlat({
			prefix: toListPrefix(this.fullPath(prefix), prefix),
		});

		// 2. Skip folder placeholder blobs, as the S3 and GCS drivers do: a name ending in `/` is a zero-byte marker an
		//    empty "folder" is created with, not an object a caller can read, and listing it would hand a consumer a
		//    path that only exists on this backend. Strip the root and its slash from the rest, so callers get paths in
		//    the form they pass in
		for await (const blob of blobs) {
			if ((blob.name as string).endsWith('/')) continue;

			yield toRelativePath(this.root, blob.name as string);
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
		//    when an unfinished append blob may be discarded. Checksum and concatenation are left out because an append
		//    blob can neither verify a chunk before it lands nor be assembled from several uploads
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start a resumable upload by creating an empty append blob under the final name.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param context - Client-supplied size and metadata.
	 * @returns The context unchanged; the append blob itself carries all the upload state.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// 1. An append blob must exist before blocks can be appended; `createIfNotExists` keeps a retried creation from
		//    wiping blocks already appended
		await this.containerClient.getAppendBlobClient(this.fullPath(filepath)).createIfNotExists();

		return context;
	}

	/**
	 * Append one TUS chunk to the upload's append blob.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param _context - Upload context; unused, the append blob tracks its own length.
	 * @returns The new upload offset: `offset` plus the bytes appended.
	 * @throws Error when the chunk exceeds the size configured as `tus.chunkSize`, or the append-block limit when no
	 * size was configured.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		_context: ChunkedUploadContext,
	): Promise<number> {
		const client = this.containerClient.getAppendBlobClient(this.fullPath(filepath));

		let bytesUploaded = offset || 0;
		let chunkSize = 0;

		const chunks: Buffer[] = [];

		// 1. Buffer the chunk as it streams in, counting bytes on the way: `appendBlock` needs the exact byte length
		//    up front, which a stream cannot give; the moment the incoming chunk crosses the bound the stream is
		//    destroyed and the error thrown, so an oversized chunk is refused while it is still arriving rather than
		//    after the whole of it has been buffered
		for await (let chunk of content) {
			if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);

			chunkSize += chunk.length;
			bytesUploaded += chunk.length;
			chunks.push(chunk);

			// 2. One TUS chunk becomes one `Append Block` request, so a chunk above the bound is refused here, with the
			//    size named, instead of as a service error mid-upload
			if (chunkSize > this.maximumChunkSize) {
				throw new Error(
					`The chunk of ${chunkSize} bytes exceeds the chunk size limit of ${this.maximumChunkSize} bytes`,
				);
			}
		}

		const chunk = Buffer.concat(chunks);

		// 3. Skip the request for an empty chunk; the service rejects a zero-length append
		if (chunk.length > 0) {
			// 4. The append position is pinned to the offset the chunk claims to start at: append blobs always append
			//    at the current end, so a PATCH whose response was lost and which the TUS client resends at the same
			//    offset would otherwise append the same bytes a second time, silently growing the blob past its
			//    declared size. With the condition the service answers 412 instead of corrupting the upload
			await client.appendBlock(chunk, chunk.length, { conditions: { appendPosition: offset } });
		}

		return bytesUploaded;
	}

	/**
	 * Make any request of the Blob service REST API with the location's account, endpoint and a timeout — the way to
	 * what the storage contract does not cover: service properties, container metadata, leases, tags, access tiers.
	 *
	 * `method` is the verb and the path from the blob endpoint — `{container}` in it stands for the location's
	 * container — or a full URL on that endpoint's host. The request is authorised with an account SAS signed for it
	 * alone and valid for a few minutes, since the SDK keeps its signing pipeline to itself; operations an account SAS
	 * cannot authorise are refused by Azure. Every parameter goes into the query — the Blob service takes its
	 * parameters there and in headers — except `body`: a string (XML) or a `Blob` sent as the request body. Blob names
	 * in a path are not placed under the location's root.
	 *
	 * @typeParam T - What the service answers with, most often XML text; the caller knows it from Azure's documentation.
	 * @param method - The verb and path: `GET /?restype=service&comp=properties`, `PUT /{container}?restype=container`.
	 * @param params - The query, and the request body under `body`.
	 * @param options - A timeout over {@link DEFAULT_AZURE_CALL_TIMEOUT}, an abort signal, extra headers — the
	 * `x-ms-meta-*` and `x-ms-blob-type` headers many operations read.
	 * @returns The answer: parsed JSON, else its text — XML for most operations; `undefined` for an empty one.
	 * @throws ProviderCallError when Azure answers with an error status or a redirect — not followed, since the SAS
	 * rides in the URL — its status and XML answer in `extensions`.
	 * @throws HitRateLimitError when Azure answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, its URL is not on the endpoint's host, or Azure cannot be reached.
	 * @example
	 * ```ts
	 * const xml = await azure.call<string>('GET /', { restype: 'service', comp: 'properties' });
	 *
	 * await azure.call('PUT /{container}', { restype: 'container', comp: 'metadata' }, {
	 * 	headers: { 'x-ms-meta-owner': 'media' },
	 * });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The verb and the URL; a full URL off the endpoint's host is refused here, before a SAS is signed for it
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(this.endpoint, target.replaceAll('{container}', encodeURIComponent(this.containerName)));
		const { body, ...query } = params;

		for (const [key, value] of new URLSearchParams(toQueryString(query)).entries()) {
			url.searchParams.append(key, value);
		}

		// 2. A SAS for this request only: every blob permission, since the operation is the caller's choice, and a
		//    lifetime of minutes. The start lies a minute back, so a service clock slightly behind still accepts it
		const now = Date.now();

		const sas = generateAccountSASQueryParameters(
			{
				startsOn: new Date(now - 60_000),
				expiresOn: new Date(now + CALL_SAS_LIFETIME),
				permissions: AccountSASPermissions.parse('rwdxylacuptfi'),
				services: 'b',
				resourceTypes: 'sco',
				...(url.protocol === 'https:' ? { protocol: SASProtocol.Https } : {}),
			},
			this.signedCredentials,
		);

		const signed = new URL(url);

		for (const [key, value] of new URLSearchParams(sas.toString()).entries()) {
			signed.searchParams.append(key, value);
		}

		// 3. The API version the SAS was signed for, the body's type unless the caller names one, the caller's headers on
		//    top; header names folded to lower case so the caller's replace the driver's instead of doubling them
		const headers: Record<string, string> = { 'x-ms-version': sas.version };

		if (typeof body === 'string') headers['content-type'] = 'application/xml';
		if (body instanceof Blob) headers['content-type'] = body.type || 'application/octet-stream';

		for (const [name, value] of Object.entries(options.headers ?? {})) {
			headers[name.toLowerCase()] = value;
		}

		// 4. The request and the reading of its answer under one deadline — a slow body is still the deadline's — and
		//    the caller's signal aborts both. Only a string or a Blob is a body
		const payload = typeof body === 'string' || body instanceof Blob ? body : undefined;

		const { response, answer } = await withTimeout(
			async (signal) => {
				// 1. Redirects are not followed: the SAS rides in the URL, and `fetch` would carry it to wherever the
				//    `Location` points. A failure to reach Azure is reported without its cause, whose details may quote
				//    the signed URL; an abort passes on its own reason
				let sent: Response;

				try {
					sent = await fetch(signed.href, {
						method: verb,
						headers,
						signal,
						redirect: 'manual',
						...(payload === undefined ? {} : { body: payload }),
					});
				} catch (error) {
					if (signal.aborted) throw signal.reason;

					const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
					const suffix = typeof code === 'string' ? ` (${code})` : '';

					// eslint-disable-next-line preserve-caught-error -- the cause may quote the signed URL
					throw new Error(`The azure call "${method}" could not reach the service${suffix}`);
				}

				// 2. JSON when it parses, the text otherwise — XML for most operations; an empty answer is nothing
				return { response: sent, answer: await parseAnswer(sent) };
			},
			options.timeout ?? DEFAULT_AZURE_CALL_TIMEOUT,
			options.signal ? { signal: options.signal } : {},
		);

		// 5. An error status — or a redirect, which is not followed — becomes the kit's error; the signature is struck
		//    from the answer, should Azure quote it, so no error or log line ever carries a working SAS
		if (response.status >= 300) {
			throw toProviderCallError({
				provider: 'azure',
				method,
				status: response.status,
				body: typeof answer === 'string' ? redact(answer, sas.signature) : answer,
				headers: response.headers,
			});
		}

		return answer as T;
	}

	/**
	 * Complete a resumable upload.
	 *
	 * The append blob already holds every chunk under the final name, so there is nothing to assemble.
	 *
	 * @param _filepath - Final blob path relative to the root; unused.
	 * @param _context - Upload context; unused.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {}

	/**
	 * Abort a resumable upload by removing its append blob.
	 *
	 * @param filepath - Final blob path relative to the root.
	 * @param _context - Upload context; unused.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. The append blob lives under the final name, so a plain delete is all it takes to discard the upload
		await this.delete(filepath);
	}
}

/**
 * Read a response's body: JSON when it parses, the text otherwise.
 *
 * @param response - The response.
 * @returns The parsed body, the text, or `undefined` for an empty one.
 * @internal
 */
const parseAnswer = async (response: Response): Promise<unknown> => {
	// 1. An empty body — a 201 of a created container, any HEAD — is nothing rather than an empty string
	const text = await response.text();

	if (text.length === 0) return undefined;

	// 2. The Blob service answers XML, which is returned as it came; the odd JSON answer is parsed
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
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
	// 1. Both forms, since Azure may quote the URL it was sent as well as the decoded value
	if (!signature) return text;

	return text.replaceAll(signature, '[redacted]').replaceAll(encodeURIComponent(signature), '[redacted]');
};
