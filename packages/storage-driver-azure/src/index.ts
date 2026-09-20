import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import type { TusDriver } from '@novastarter/storage';
import type { ChunkedUploadContext, ReadOptions } from '@novastarter/types';
import { normalizePath } from '@novastarter/utils';

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
 * Options accepted by {@link DriverAzure}.
 *
 * Authentication is by shared key only: `accountName` and `accountKey` are turned into a
 * `StorageSharedKeyCredential`, so every request is signed with the account key.
 */
export type DriverAzureConfig = {
	/** Blob container every operation targets. */
	containerName: string;
	/** Storage account name; also used to derive the default endpoint. */
	accountName: string;
	/** Shared account key requests are signed with. */
	accountKey: string;
	/** Path prefix every blob is placed under; behaves like a root directory inside the container. */
	root?: string;
	/**
	 * Custom blob service endpoint, e.g. for Azurite or sovereign clouds.
	 *
	 * @defaultValue `https://<accountName>.blob.core.windows.net`
	 */
	endpoint?: string;
	/** Resumable-upload tuning. */
	tus?: {
		/** Whether resumable uploads are switched on; only then is `chunkSize` validated. */
		enabled: boolean;
		/** Chunk size in bytes appended per TUS PATCH request; must not exceed {@link MAXIMUM_CHUNK_SIZE}. */
		chunkSize?: number;
	};
};

/**
 * Storage driver backed by Azure Blob Storage.
 *
 * Plain files are stored as block blobs through `@azure/storage-blob`. Resumable (TUS) uploads use an append blob
 * under the final blob name: each incoming chunk becomes one `Append Block` request, so no part bookkeeping is needed
 * and the blob is complete as soon as the last chunk lands.
 *
 * @example
 * ```ts
 * const driver = new DriverAzure({
 *     containerName: 'uploads',
 *     accountName: 'myaccount',
 *     accountKey: process.env.AZURE_KEY,
 * });
 *
 * await driver.write('avatar.png', fs.createReadStream('./avatar.png'), 'image/png');
 * ```
 */
export class DriverAzure implements TusDriver {
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
	 * Normalised root prefix without a leading slash; an empty string when none was configured.
	 *
	 * @internal
	 */
	private root: string;

	/**
	 * Create a driver together with its credential and container handle.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws Error when resumable uploads are enabled with a `chunkSize` above {@link MAXIMUM_CHUNK_SIZE}.
	 */
	constructor(config: DriverAzureConfig) {
		// 1. Build the credential once; the SDK signs every request with it, so there is no per-call auth step
		this.signedCredentials = new StorageSharedKeyCredential(config.accountName, config.accountKey);

		// 2. A custom endpoint wins over the derived one, so emulators and non-public clouds are never routed to
		//    `blob.core.windows.net`
		const client = new BlobServiceClient(
			config.endpoint ?? `https://${config.accountName}.blob.core.windows.net`,
			this.signedCredentials,
		);

		this.containerClient = client.getContainerClient(config.containerName);

		// 3. Strip the leading slash from the root: blob names are not paths, and a leading `/` would become part of
		//    the name and produce blobs nobody can find by the expected key
		this.root = config.root ? normalizePath(config.root, { removeLeading: true }) : '';

		// 4. Fail at construction rather than on the first chunk: the service rejects appended blocks above the limit,
		//    and a misconfigured size would otherwise only surface mid-upload
		//    https://learn.microsoft.com/en-us/rest/api/storageservices/append-block?tabs=microsoft-entra-id#remarks
		if (config.tus?.enabled && config.tus.chunkSize && config.tus.chunkSize > MAXIMUM_CHUNK_SIZE) {
			throw new Error('Invalid chunkSize provided');
		}
	}

	/**
	 * Resolve a caller path to the blob name inside the container.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The blob name with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. Normalising turns the platform separators `join` may produce into the forward slashes blob names use
		return normalizePath(join(this.root, filepath));
	}

	/**
	 * Stream a blob's contents.
	 *
	 * @param filepath - Blob path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns The download body as a Node stream.
	 * @throws Error when the SDK returns no body to stream.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options || {};

		// 1. The SDK takes an offset and a count rather than a closed range, so `end` is turned into a count from the
		//    start (inclusive, hence the `+ 1`); with no `end` the count stays undefined and the rest of the blob is read
		const { readableStreamBody } = await this.containerClient
			.getBlobClient(this.fullPath(filepath))
			.download(range?.start, range?.end ? range.end - (range.start || 0) + 1 : undefined);

		// 2. `readableStreamBody` is only set in Node (browsers get `blobBody` instead), so its absence here means there
		//    is nothing to stream
		if (!readableStreamBody) {
			throw new Error(`No stream returned for file "${filepath}"`);
		}

		return readableStreamBody as Readable;
	}

	/**
	 * Upload a stream as a block blob, replacing any existing content.
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
	 * @throws The SDK error when the blob is missing.
	 */
	async stat(filepath: string): Promise<{
		size: number;
		modified: Date;
	}> {
		// 1. `getProperties` is a HEAD request, so the metadata comes back without downloading the body
		const props = await this.containerClient.getBlobClient(this.fullPath(filepath)).getProperties();

		return {
			size: props.contentLength as number,
			modified: props.lastModified as Date,
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
	 * @returns Blob paths relative to the root.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. A flat listing walks every blob under the prefix regardless of virtual folders, which is what a recursive
		//    listing expects
		const blobs = this.containerClient.listBlobsFlat({
			prefix: this.fullPath(prefix),
		});

		// 2. Strip the root so callers get paths in the form they pass in
		for await (const blob of blobs) {
			yield (blob.name as string).substring(this.root.length);
		}
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 */
	get tusExtensions(): string[] {
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
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		_context: ChunkedUploadContext,
	): Promise<number> {
		const client = this.containerClient.getAppendBlobClient(this.fullPath(filepath));

		let bytesUploaded = offset || 0;

		const chunks: Buffer[] = [];

		// 1. Buffer the whole chunk first: `appendBlock` needs the exact byte length up front, which a stream cannot
		//    give; the chunk is bounded by the configured size, so it stays within `MAXIMUM_CHUNK_SIZE`
		content.on('data', (chunk: Buffer) => {
			bytesUploaded += chunk.length;
			chunks.push(chunk);
		});

		await finished(content);

		const chunk = Buffer.concat(chunks);

		// 2. Skip the request for an empty chunk; the service rejects a zero-length append
		if (chunk.length > 0) {
			await client.appendBlock(chunk, chunk.length);
		}

		return bytesUploaded;
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
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverAzure;
