import fs, { promises as fsProm } from 'node:fs';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import os from 'node:os';
import { join } from 'node:path';
import stream, { type Readable, promises as streamProm } from 'node:stream';
import type {
	CompletedPart,
	CopyObjectCommandInput,
	CreateMultipartUploadCommandInput,
	GetObjectCommandInput,
	ListObjectsV2CommandInput,
	ObjectCannedACL,
	Part,
	PutObjectCommandInput,
	S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	S3Client,
	ServerSideEncryption,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { TusDriver } from '@novastarter/storage';
import type { ChunkedUploadContext, ReadOptions } from '@novastarter/types';
import { normalizePath } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { Permit, Semaphore } from '@shopify/semaphore';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ERRORS, StreamSplitter, TUS_RESUMABLE } from '@tus/utils';
import ms, { type StringValue } from 'ms';

/**
 * Options accepted by {@link DriverS3}.
 *
 * `key` and `secret` are optional as a pair: leave both out to let the AWS SDK resolve credentials from the
 * environment, shared config or instance metadata. Timeouts are in milliseconds.
 */
export type DriverS3Config = {
	/** Key prefix every path is placed under; behaves like a root directory inside the bucket. */
	root?: string;
	/** Access key id. Must be set together with `secret`. */
	key?: string;
	/** Secret access key. Must be set together with `key`. */
	secret?: string;
	/** Bucket every operation targets. */
	bucket: string;
	/** Canned ACL applied to written and copied objects. */
	acl?: ObjectCannedACL;
	/** Server-side encryption requested for written and copied objects. */
	serverSideEncryption?: ServerSideEncryption;
	/** KMS key to encrypt with; only sent for the KMS-based encryption modes listed in {@link kmsKeyIdCheck}. */
	serverSideEncryptionKmsKeyId?: string;
	/** Custom endpoint for S3-compatible services; `https` is assumed unless the value starts with `http://`. */
	endpoint?: string;
	/** AWS region of the bucket. */
	region?: string;
	/** Address the bucket as a path (`host/bucket`) instead of a subdomain, as most S3-compatible services need. */
	forcePathStyle?: boolean;
	/** Resumable-upload tuning. */
	tus?: {
		/** Preferred multipart part size in bytes; grown automatically when an upload would exceed the part limit. */
		chunkSize?: number;
	};
	/** Time allowed to establish a TCP connection. @defaultValue 5000 */
	connectionTimeout?: number;
	/** Time a socket may sit idle before the request is aborted. @defaultValue 120000 */
	socketTimeout?: number;
	/** Maximum concurrent sockets per host. @defaultValue 500 */
	maxSockets?: number;
	/** Reuse TCP connections between requests. @defaultValue true */
	keepAlive?: boolean;
};

/**
 * Encryption modes that take a KMS key id.
 *
 * S3 rejects `SSEKMSKeyId` for any other mode, so the driver only forwards the configured key when the mode is one of
 * these.
 */
export const kmsKeyIdCheck = [
	ServerSideEncryption.aws_kms,
	ServerSideEncryption.aws_kms_dsse,
] as ServerSideEncryption[];

/**
 * Storage driver backed by Amazon S3 or an S3-compatible service.
 *
 * Plain operations map one-to-one onto S3 commands. Resumable (TUS) uploads are built on S3 multipart uploads and
 * follow the S3 store of tus-node-server (https://github.com/tus/tus-node-server): each incoming chunk is split into
 * parts of at least the S3 minimum size, buffered on local disk and uploaded concurrently under a semaphore.
 *
 * @example
 * ```ts
 * const driver = new DriverS3({ bucket: 'uploads', region: 'eu-west-1', root: 'media' });
 *
 * await driver.write('avatar.png', fs.createReadStream('./avatar.png'), 'image/png');
 * ```
 */
export class DriverS3 implements TusDriver {
	/**
	 * Options this instance was created with.
	 *
	 * @internal
	 */
	private config: DriverS3Config;

	/**
	 * Shared SDK client; one per driver so the connection pool is reused across calls.
	 *
	 * @internal
	 */
	private readonly client: S3Client;

	/**
	 * Normalised key prefix without a leading slash, or an empty string when no root was configured.
	 *
	 * @internal
	 */
	private readonly root: string;

	/**
	 * Caps the number of multipart parts in flight at once across every resumable upload handled by this instance.
	 *
	 * @internal
	 */
	private partUploadSemaphore: Semaphore;

	/**
	 * Part size the upload splitter aims for, taken from `tus.chunkSize` or the S3 minimum.
	 *
	 * @internal
	 */
	private readonly preferredPartSize: number;

	/**
	 * Most parts a single S3 multipart upload may contain.
	 *
	 * @defaultValue 10 000, the S3 hard limit.
	 */
	public maxMultipartParts = 10_000 as const;

	/**
	 * Smallest part S3 accepts for every part except the last.
	 *
	 * @defaultValue 5 MiB, the S3 hard limit.
	 */
	public minPartSize = 5_242_880 as const;

	/**
	 * Largest object S3 can store, used to size parts when the upload length is unknown.
	 *
	 * @defaultValue 5 TiB, the S3 hard limit.
	 */
	public maxUploadSize = 5_497_558_138_880 as const;

	/**
	 * Create a driver and its SDK client.
	 *
	 * @param config - Connection and behaviour options.
	 * @throws Error when only one of `key` and `secret` is given.
	 */
	constructor(config: DriverS3Config) {
		// 1. Build the client up front, so credential mistakes fail at construction instead of on the first request
		this.config = config;
		this.client = this.getClient();

		// 2. Store the root without a leading slash: S3 keys are not paths, and a leading `/` would become part of
		//    the key and produce objects nobody can find by the expected name
		this.root = this.config.root ? normalizePath(this.config.root, { removeLeading: true }) : '';

		// 3. Sixty concurrent part uploads is the tus-node-server default, a balance between throughput and the
		//    number of open sockets and temp files
		this.preferredPartSize = config.tus?.chunkSize ?? this.minPartSize;
		this.partUploadSemaphore = new Semaphore(60);
	}

	/**
	 * Build the SDK client from the driver options.
	 *
	 * @returns A configured client.
	 * @throws Error when only one of `key` and `secret` is given.
	 * @internal
	 */
	private getClient() {
		// 1. Replace the SDK's default request handler: its agent caps at 50 sockets, so bursts of requests queue
		//    behind that limit. Timeouts pass through `ms`, which accepts both plain milliseconds and duration
		//    strings, so values from untyped configuration still resolve to a number
		const connectionTimeout = ms(String(this.config.connectionTimeout ?? 5000) as StringValue);
		const socketTimeout = ms(String(this.config.socketTimeout ?? 120000) as StringValue);
		const maxSockets = this.config.maxSockets ?? 500;
		const keepAlive = this.config.keepAlive ?? true;

		const s3ClientConfig: S3ClientConfig = {
			requestHandler: new NodeHttpHandler({
				connectionTimeout,
				socketTimeout,
				httpAgent: new HttpAgent({ maxSockets, keepAlive }),
				httpsAgent: new HttpsAgent({ maxSockets, keepAlive }),
			}),
		};

		// 2. Half a credential pair is a configuration error, never an intent to fall back to the SDK provider chain
		if ((this.config.key && !this.config.secret) || (this.config.secret && !this.config.key)) {
			throw new Error('Both `key` and `secret` are required when defined');
		}

		// 3. Pass explicit credentials only when both halves exist; otherwise the SDK resolves them from the
		//    environment, shared config or instance metadata
		if (this.config.key && this.config.secret) {
			s3ClientConfig.credentials = {
				accessKeyId: this.config.key,
				secretAccessKey: this.config.secret,
			};
		}

		// 4. Split a custom endpoint into the object form the SDK expects. `https` is the default because only local
		//    setups run S3-compatible services over plain `http`
		if (this.config.endpoint) {
			const protocol = this.config.endpoint.startsWith('http://') ? 'http:' : 'https:';
			const hostname = this.config.endpoint.replace('https://', '').replace('http://', '');

			s3ClientConfig.endpoint = {
				hostname,
				protocol,
				path: '/',
			};
		}

		// 5. Region and path style are only set when configured, so the SDK keeps its own defaults and environment
		//    lookups otherwise
		if (this.config.region) {
			s3ClientConfig.region = this.config.region;
		}

		if (this.config.forcePathStyle !== undefined) {
			s3ClientConfig.forcePathStyle = this.config.forcePathStyle;
		}

		return new S3Client(s3ClientConfig);
	}

	/**
	 * Resolve a caller path to the object key inside the bucket.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The key with the root prefixed and separators normalised.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. `join` copes with an empty root and doubled slashes; normalising afterwards turns the platform separators
		//    it may produce into the forward slashes S3 keys use
		return normalizePath(join(this.root, filepath));
	}

	/**
	 * Stream an object's contents.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns The response body as a Node stream.
	 * @throws Error when S3 returns no body, or a body that is not a Node readable.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options ?? {};

		const commandInput: GetObjectCommandInput = {
			Key: this.fullPath(filepath),
			Bucket: this.config.bucket,
		};

		// 1. Translate the range into the HTTP header form: an omitted bound becomes an empty side, so `end` alone
		//    yields `bytes=-N`, which S3 reads as the last N bytes rather than the first
		if (range) {
			commandInput.Range = `bytes=${range.start ?? ''}-${range.end ?? ''}`;
		}

		const { Body: stream } = await this.client.send(new GetObjectCommand(commandInput));

		// 2. The SDK types the body as a union of Node, Web and blob streams; only a Node readable is usable by the
		//    rest of the storage layer, so anything else counts as a failed read
		if (!stream || !isReadableStream(stream)) {
			throw new Error(`No stream returned for file "${filepath}"`);
		}

		return stream as Readable;
	}

	/**
	 * Read an object's size and last-modified time through a HEAD request.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws The SDK error when the object is missing or the request fails.
	 */
	async stat(filepath: string): Promise<{
		size: number;
		modified: Date;
	}> {
		// 1. HEAD returns the metadata without transferring the body, which is all this call needs
		const { ContentLength, LastModified } = await this.client.send(
			new HeadObjectCommand({
				Key: this.fullPath(filepath),
				Bucket: this.config.bucket,
			}),
		);

		// 2. Both fields are typed optional by the SDK but always present on a successful HEAD, hence the casts
		return {
			size: ContentLength as number,
			modified: LastModified as Date,
		};
	}

	/**
	 * Check whether an object is present.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns `true` when the object exists, `false` when S3 answers 404.
	 * @throws Any other failure, such as denied credentials or a timeout, since it says nothing about the object.
	 */
	async exists(filepath: string): Promise<boolean> {
		// 1. Reuse the HEAD request behind `stat`; a successful answer is proof of existence
		try {
			await this.stat(filepath);
			return true;
		} catch (error) {
			// 2. A HEAD response has no body, so 404 is the only answer that confirms the object is missing. Treating
			//    any other failure as "not found" would make callers act on a wrong answer
			if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return false;

			throw error;
		}
	}

	/**
	 * Move an object by copying it to the new key and deleting the old one.
	 *
	 * S3 has no rename, so this takes two requests and is not atomic: a failure after the copy leaves both objects in
	 * place.
	 *
	 * @param src - Current object path.
	 * @param dest - Path to move the object to.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. Copy before deleting, so a failure at any point never loses the data
		await this.copy(src, dest);
		await this.delete(src);
	}

	/**
	 * Copy an object to a new key within the bucket.
	 *
	 * @param src - Object to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		// 1. `CopySource` is a URL-style `/bucket/key` reference, unlike the plain `Key` used for the target
		const params: CopyObjectCommandInput = {
			Key: this.fullPath(dest),
			Bucket: this.config.bucket,
			CopySource: `/${this.config.bucket}/${this.fullPath(src)}`,
		};

		// 2. S3 does not carry encryption or ACL over from the source object; both have to be restated on the copy
		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (kmsKeyIdCheck.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		if (this.config.acl) {
			params.ACL = this.config.acl;
		}

		await this.client.send(new CopyObjectCommand(params));
	}

	/**
	 * Upload a stream as an object, replacing any existing content.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param content - Data to store.
	 * @param type - MIME type stored as the object's `Content-Type`.
	 */
	async write(filepath: string, content: Readable, type?: string): Promise<void> {
		const params: PutObjectCommandInput = {
			Key: this.fullPath(filepath),
			Body: content,
			Bucket: this.config.bucket,
		};

		// 1. Set the optional headers only when configured, so the bucket defaults apply otherwise
		if (type) {
			params.ContentType = type;
		}

		if (this.config.acl) {
			params.ACL = this.config.acl;
		}

		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (kmsKeyIdCheck.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		// 2. `Upload` from lib-storage streams a body of unknown length as a multipart upload; a plain
		//    `PutObjectCommand` needs the content length up front, which a stream cannot provide
		const upload = new Upload({
			client: this.client,
			params,
		});

		await upload.done();
	}

	/**
	 * Remove an object.
	 *
	 * S3 answers a delete of a missing key with success, so this never throws for an absent object.
	 *
	 * @param filepath - Object path relative to the root.
	 */
	async delete(filepath: string): Promise<void> {
		// 1. No `VersionId` is passed: the driver never enables versioning, so the plain delete removes the current object
		await this.client.send(
			new DeleteObjectCommand({
				Key: this.fullPath(filepath),
				Bucket: this.config.bucket,
			}),
		);
	}

	/**
	 * Enumerate object paths under a prefix, page by page.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root. Keys ending in `/` (folder placeholders) are skipped.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		let Prefix = this.fullPath(prefix);

		// 1. With no root and no prefix `join` yields `.`, which S3 would take as a literal key prefix and match nothing
		if (Prefix === '.') Prefix = '';

		let continuationToken: string | undefined = undefined;

		// 2. S3 returns at most 1000 keys per call; keep requesting with the continuation token until it runs out.
		//    Yielding inside the loop keeps memory flat for large buckets
		do {
			const listObjectsV2CommandInput: ListObjectsV2CommandInput = {
				Bucket: this.config.bucket,
				Prefix,
				MaxKeys: 1000,
			};

			if (continuationToken) {
				listObjectsV2CommandInput.ContinuationToken = continuationToken;
			}

			const response = await this.client.send(new ListObjectsV2Command(listObjectsV2CommandInput));

			continuationToken = response.NextContinuationToken;

			// 3. Skip folder placeholder objects and strip the root, so callers get paths in the form they pass in
			if (response.Contents) {
				for (const object of response.Contents) {
					if (!object.Key) continue;

					const isDir = object.Key.endsWith('/');

					if (isDir) continue;

					yield object.Key.substring(this.root.length);
				}
			}
		} while (continuationToken);
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 */
	get tusExtensions(): string[] {
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start an S3 multipart upload for a resumable upload.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Client-supplied size and metadata; the `contentType` and `cacheControl` keys are forwarded to
	 * S3.
	 * @returns The same context with the multipart `upload-id` stored in its metadata for the following calls.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// 1. Tag the object with the TUS version and copy the client's content headers into the create request: S3
		//    only accepts them when the multipart upload is created, not when it is completed
		const params: CreateMultipartUploadCommandInput = {
			Bucket: this.config.bucket,
			Key: this.fullPath(filepath),
			Metadata: { 'tus-version': TUS_RESUMABLE },
			...(context.metadata?.['contentType']
				? {
						ContentType: context.metadata['contentType'],
					}
				: {}),
			...(context.metadata?.['cacheControl']
				? {
						CacheControl: context.metadata['cacheControl'],
					}
				: {}),
		};

		// 2. Same encryption rules as a plain write; the KMS key id is only valid for the KMS modes
		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (kmsKeyIdCheck.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		const command = new CreateMultipartUploadCommand(params);

		const res = await this.client.send(command);

		// 3. Keep the upload id in the context: it is the only handle S3 gives for adding parts, and the context is
		//    what the TUS server hands back on every later call
		context.metadata!['upload-id'] = res.UploadId!;

		return context;
	}

	/**
	 * Abort a resumable upload and remove whatever sits under its key.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Context carrying the multipart `upload-id`.
	 * @throws `ERRORS.FILE_NOT_FOUND` from `@tus/utils` when S3 reports the upload or key as missing, so the TUS
	 * server answers 404 instead of 500.
	 */
	async deleteChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const key = this.fullPath(filepath);

		// 1. Abort the multipart upload first: S3 keeps (and bills for) uploaded parts until the upload is completed
		//    or aborted. Skipped when no upload id was ever recorded
		try {
			// @ts-expect-error metadata is typed as possibly undefined; a missing object throws inside the try and is rethrown as a real failure
			const { 'upload-id': uploadId } = context.metadata;

			if (uploadId) {
				await this.client.send(
					new AbortMultipartUploadCommand({
						Bucket: this.config.bucket,
						Key: key,
						UploadId: uploadId,
					}),
				);
			}
		} catch (error: any) {
			// 2. Map the S3 "missing" family of errors onto the TUS not-found error; anything else is a real failure
			if (error?.code && ['NotFound', 'NoSuchKey', 'NoSuchUpload'].includes(error.Code)) {
				throw ERRORS.FILE_NOT_FOUND;
			}

			throw error;
		}

		// 3. Remove the object under the key as well, so a termination after a completed upload does not leave the
		//    file behind
		await this.client.send(
			new DeleteObjectsCommand({
				Bucket: this.config.bucket,
				Delete: {
					Objects: [{ Key: key }],
				},
			}),
		);
	}

	/**
	 * Complete the multipart upload once every part has arrived.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Context carrying the multipart `upload-id` and the total `size`.
	 * @throws An object with `status_code: 500` when S3 still reports fewer parts than expected after three retries,
	 * in the shape the TUS server turns into an HTTP response.
	 */
	async finishChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const key = this.fullPath(filepath);
		const uploadId = context.metadata!['upload-id'] as string;

		// 1. Recompute the part size the same way `uploadParts` did, so the expected part count matches what was sent
		const size = context.size!;
		const chunkSize = this.calcOptimalPartSize(size);
		const expectedParts = Math.ceil(size / chunkSize);

		let parts = await this.retrieveParts(key, uploadId);
		let retries = 0;

		// 2. The listing may not yet show the last parts; poll with growing pauses (0.5 s, 1 s, 1.5 s) before giving up
		while (parts.length !== expectedParts && retries < 3) {
			++retries;

			await new Promise((resolve) => setTimeout(resolve, 500 * retries));
			parts = await this.retrieveParts(key, uploadId);
		}

		// 3. Completing with a part missing would produce a truncated object, so refuse and let the client retry
		if (parts.length !== expectedParts) {
			throw {
				status_code: 500,
				body: 'Failed to upload all parts to S3.',
			};
		}

		await this.finishMultipartUpload(key, uploadId, parts);
	}

	/**
	 * Upload one TUS chunk as one or more multipart parts.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param context - Context carrying the multipart `upload-id` and the total `size`.
	 * @returns The new upload offset: `offset` plus the bytes that reached S3.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		const key = this.fullPath(filepath);
		const uploadId = context.metadata!['upload-id'] as string;
		const size = context.size!;

		// 1. Part numbers must be unique and increasing within an upload; ask S3 which parts exist instead of keeping
		//    a counter, so a resumed upload continues from the right number
		const parts = await this.retrieveParts(key, uploadId);
		const partNumber: number = parts.length > 0 ? parts[parts.length - 1]!.PartNumber! : 0;
		const nextPartNumber = partNumber + 1;
		const requestedOffset = offset;

		// 2. Report what actually reached S3 rather than the chunk length: a chunk that ended mid-part is not counted,
		//    and the client resends those bytes on its next request
		const bytesUploaded = await this.uploadParts(key, uploadId, size, content, nextPartNumber, offset);

		return requestedOffset + bytesUploaded;
	}

	/**
	 * Upload a single multipart part.
	 *
	 * @param key - Object key of the upload.
	 * @param uploadId - Multipart upload id.
	 * @param readStream - Part contents.
	 * @param partNumber - One-based part index within the upload.
	 * @returns The part's ETag, which S3 asks for again when the upload is completed.
	 * @throws The SDK error when S3 rejects the part.
	 * @internal
	 */
	private async uploadPart(
		key: string,
		uploadId: string,
		readStream: fs.ReadStream | Readable,
		partNumber: number,
	): Promise<string> {
		// 1. The body is a stream over the temp file rather than the network chunk: the SDK sizes the request from the
		//    file, which a live stream cannot provide
		const data = await this.client.send(
			new UploadPartCommand({
				Bucket: this.config.bucket,
				Key: key,
				UploadId: uploadId,
				PartNumber: partNumber,
				Body: readStream,
			}),
		);

		return data.ETag as string;
	}

	/**
	 * Split an incoming chunk into S3-sized parts and upload them concurrently.
	 *
	 * `StreamSplitter` writes the stream to one temporary file per part, because S3 needs a known length per part and
	 * the incoming stream cannot be rewound. A part smaller than the S3 minimum is dropped unless it is the final one;
	 * the client resends those bytes with its next request.
	 *
	 * @param key - Object key of the upload.
	 * @param uploadId - Multipart upload id.
	 * @param size - Total size of the upload, used to size parts and to recognise the final one.
	 * @param readStream - Chunk data.
	 * @param currentPartNumber - Part number assigned to the first part produced.
	 * @param offset - Upload offset at the start of the chunk.
	 * @returns Bytes accepted by S3 from this chunk.
	 * @throws The first error raised by the splitter pipeline or by a part upload.
	 * @internal
	 */
	private async uploadParts(
		key: string,
		uploadId: string,
		size: number,
		readStream: stream.Readable,
		currentPartNumber: number,
		offset: number,
	): Promise<number> {
		const promises: Promise<void>[] = [];
		let pendingChunkFilepath: string | null = null;
		let bytesUploaded = 0;
		let permit: Permit | undefined = undefined;

		// 1. The splitter emits an event per part; the handlers below upload each part as soon as it is on disk, while
		//    later parts are still being written
		const splitterStream = new StreamSplitter({
			chunkSize: this.calcOptimalPartSize(size),
			directory: os.tmpdir(),
		})
			.on('beforeChunkStarted', async () => {
				// 1. Take a semaphore permit before a part is buffered, so disk usage stays bounded along with the
				//    number of in-flight uploads
				permit = await this.partUploadSemaphore.acquire();
			})
			.on('chunkStarted', (filepath) => {
				// 1. Remember the file being written, so it can be removed if the pipeline fails mid-part
				pendingChunkFilepath = filepath;
			})
			.on('chunkFinished', ({ path, size: partSize }) => {
				// 1. The part file is complete, so the error path no longer has anything to clean up for it
				pendingChunkFilepath = null;

				// 2. Capture the part number and permit now: this handler runs once per part, and the shared
				//    variables move on before the upload below finishes
				const partNumber = currentPartNumber++;
				const acquiredPermit = permit;

				offset += partSize;

				const isFinalPart = size === offset;

				// 3. Upload in the background and collect the promise; awaiting here would serialise the parts
				// eslint-disable-next-line no-async-promise-executor
				const deferred = new Promise<void>(async (resolve, reject) => {
					try {
						const readable = fs.createReadStream(path);
						readable.on('error', reject);

						// 1. S3 rejects a part under the minimum size unless it is the last one, so a short trailing
						//    part is skipped and left uncounted: the returned offset then makes the client resend it
						if (partSize >= this.minPartSize || isFinalPart) {
							await this.uploadPart(key, uploadId, readable, partNumber);
							bytesUploaded += partSize;
						} else {
							// This can happen if the upload is aborted by the user mid chunk or a network issue happens
							// await this.uploadIncompletePart(metadata.file.id, readable);
						}

						resolve();
					} catch (error) {
						reject(error);
					} finally {
						// 2. The temp file is spent either way, and a failed removal is not worth failing the upload
						//    over. Releasing the permit lets the next part start
						fsProm.rm(path).catch(() => {
							/* ignore */
						});

						acquiredPermit?.release();
					}
				});

				promises.push(deferred);
			})
			.on('chunkError', () => {
				// 1. A splitter failure never reaches `chunkFinished`, so the permit taken for that part is freed here
				permit?.release();
			});

		// 2. Drive the incoming stream through the splitter; every part upload is queued by the time this resolves
		try {
			await streamProm.pipeline(readStream, splitterStream);
		} catch (error) {
			// 3. Clean up the half-written part file, then surface the pipeline error together with the upload results
			if (pendingChunkFilepath !== null) {
				try {
					await fsProm.rm(pendingChunkFilepath);
				} catch {
					// this.logger.error(`[${metadata.file.id}] failed to remove chunk ${pendingChunkFilepath}`);
				}
			}

			promises.push(Promise.reject(error));
		} finally {
			// 4. Wait for every queued upload, so the returned byte count reflects what actually reached S3
			await Promise.all(promises);
		}

		return bytesUploaded;
	}

	/**
	 * List every part uploaded so far, following pagination.
	 *
	 * @param key - Object key of the upload.
	 * @param uploadId - Multipart upload id.
	 * @param partNumberMarker - Continue after this part number; only set on recursive calls.
	 * @returns All parts sorted by part number.
	 * @internal
	 */
	private async retrieveParts(key: string, uploadId: string, partNumberMarker?: string): Promise<Part[]> {
		const data = await this.client.send(
			new ListPartsCommand({
				Bucket: this.config.bucket,
				Key: key,
				UploadId: uploadId,
				PartNumberMarker: partNumberMarker!,
			}),
		);

		let parts = data.Parts ?? [];

		// 1. S3 pages the listing; recurse with the marker so callers always see the complete set
		if (data.IsTruncated) {
			const rest = await this.retrieveParts(key, uploadId, data.NextPartNumberMarker);
			parts = [...parts, ...rest];
		}

		// 2. Sort once at the outermost call: `CompleteMultipartUpload` requires ascending part numbers, and
		//    `writeChunk` reads the highest number from the last element
		if (!partNumberMarker) {
			parts.sort((a, b) => a.PartNumber! - b.PartNumber!);
		}

		return parts;
	}

	/**
	 * Tell S3 to assemble the uploaded parts into the final object.
	 *
	 * @param key - Object key of the upload.
	 * @param uploadId - Multipart upload id.
	 * @param parts - Parts in ascending order, as returned by {@link DriverS3.retrieveParts}.
	 * @returns The URL S3 reports for the assembled object.
	 * @internal
	 */
	private async finishMultipartUpload(key: string, uploadId: string, parts: Part[]) {
		// 1. The completion request takes only ETag and PartNumber per part; the size and timestamps from the listing
		//    are dropped
		const command = new CompleteMultipartUploadCommand({
			Bucket: this.config.bucket,
			Key: key,
			UploadId: uploadId,
			MultipartUpload: {
				Parts: parts.map((part) => {
					return {
						ETag: part.ETag,
						PartNumber: part.PartNumber,
					} as CompletedPart;
				}),
			},
		});

		const response = await this.client.send(command);

		return response.Location;
	}

	/**
	 * Pick a part size that keeps the upload within the S3 part-count limit.
	 *
	 * @param size - Total upload size in bytes; the S3 maximum is assumed when unknown.
	 * @returns Part size in bytes.
	 * @internal
	 */
	private calcOptimalPartSize(size?: number): number {
		// 1. Without a known length, plan for the largest object S3 allows so the part count can never overflow
		if (size === undefined) {
			size = this.maxUploadSize;
		}

		let optimalPartSize: number;

		// 2. A small upload goes in a single part; the S3 minimum only applies to parts that are not the last
		if (size <= this.preferredPartSize) {
			optimalPartSize = size;
		}
		// 3. The preferred size works as long as the upload fits in the maximum number of parts
		else if (size <= this.preferredPartSize * this.maxMultipartParts) {
			optimalPartSize = this.preferredPartSize;
		}
		// 4. Otherwise grow the parts just enough to fit: size divided by the part limit, rounded up
		else {
			optimalPartSize = Math.ceil(size / this.maxMultipartParts);
		}

		return optimalPartSize;
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default DriverS3;
