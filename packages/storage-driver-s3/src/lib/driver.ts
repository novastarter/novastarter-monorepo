import fs, { promises as fsProm } from 'node:fs';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import os from 'node:os';
import stream, { type Readable, promises as streamProm } from 'node:stream';
import type {
	CompletedPart,
	CopyObjectCommandInput,
	CreateMultipartUploadCommandInput,
	GetObjectCommandInput,
	HeadObjectCommandOutput,
	ListObjectsV2CommandInput,
	ObjectCannedACL,
	Part,
	PutObjectCommandInput,
	S3ClientConfig,
} from '@aws-sdk/client-s3';
import * as s3 from '@aws-sdk/client-s3';
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	type GetObjectCommandOutput,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	PutObjectCommand,
	S3Client,
	S3ServiceException,
	ServerSideEncryption,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { InvalidConfigError, InvalidPayloadError, toProviderCallError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, DEFAULT_REQUEST_TIMEOUT } from '@novastarter/http';
import { useLogger } from '@novastarter/logger';
import {
	type ChunkedUploadContext,
	type ReadOptions,
	type Stat,
	StorageFileNotFoundError,
	toListPrefix,
	toRelativePath,
	type TusDriver,
} from '@novastarter/storage';
import { confinePath, joinPath, retry, withTimeout } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { Permit, Semaphore } from '@shopify/semaphore';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ERRORS, StreamSplitter, TUS_RESUMABLE } from '@tus/utils';
import ms, { type StringValue } from 'ms';
import type { ChecksumMode } from '../types.js';
import { KMS_KEY_ID_MODES } from './constants.js';

/**
 * The error codes S3 and other AWS services use to ask for fewer requests; {@link StorageDriverS3.call} reports each
 * as a 429, whatever status came with it — S3's `SlowDown` comes with a 503.
 *
 * @defaultValue `SlowDown`, `ThrottlingException`, `RequestLimitExceeded`, `TooManyRequestsException`, `Throttling`
 * @internal
 */
const S3_THROTTLING_ERRORS: readonly string[] = [
	'SlowDown',
	'ThrottlingException',
	'RequestLimitExceeded',
	'TooManyRequestsException',
	'Throttling',
];

/**
 * A command class of the SDK, as {@link StorageDriverS3.call} looks it up by name.
 *
 * @internal
 */
type S3CommandConstructor = new (input: Record<string, unknown>) => Parameters<S3Client['send']>[0];

/**
 * Options accepted by {@link StorageDriverS3}.
 *
 * `key` and `secret` are optional as a pair: leave both out to let the AWS SDK resolve credentials from the
 * environment, shared config or instance metadata. Timeouts are in milliseconds.
 */
export type StorageDriverS3Config = {
	/** Key prefix every path is placed under; behaves like a root directory inside the bucket. */
	root?: string | undefined;
	/** Access key id. Must be set together with `secret`. */
	key?: string | undefined;
	/** Secret access key. Must be set together with `key`. */
	secret?: string | undefined;
	/** Bucket every operation targets. */
	bucket: string;
	/** Canned ACL applied to written and copied objects. */
	acl?: ObjectCannedACL | undefined;
	/** Server-side encryption requested for written and copied objects. */
	serverSideEncryption?: ServerSideEncryption | undefined;
	/** KMS key to encrypt with; only sent for the KMS-based encryption modes listed in {@link KMS_KEY_ID_MODES}. */
	serverSideEncryptionKmsKeyId?: string | undefined;
	/** Custom endpoint for S3-compatible services; `https` is assumed unless the value starts with `http://`. */
	endpoint?: string | undefined;
	/** AWS region of the bucket. */
	region?: string | undefined;
	/** Address the bucket as a path (`host/bucket`) instead of a subdomain, as most S3-compatible services need. */
	forcePathStyle?: boolean | undefined;
	/**
	 * When the SDK attaches a checksum to request payloads.
	 *
	 * Since `@aws-sdk/client-s3` 3.729.0 the default is `WHEN_SUPPORTED`, which sends a CRC32 checksum with every
	 * `PutObject` / `UploadPart`. Services that do not implement flexible checksums, Cloudflare R2 among them, reject
	 * those requests with `Header 'x-amz-checksum-algorithm' with value 'CRC32' not implemented`; set `WHEN_REQUIRED`
	 * for them so checksums are only sent where the S3 API demands one.
	 */
	requestChecksumCalculation?: ChecksumMode | undefined;
	/**
	 * When the SDK validates checksums on response payloads.
	 *
	 * Counterpart of {@link StorageDriverS3Config.requestChecksumCalculation}; set `WHEN_REQUIRED` for services that do not
	 * return flexible checksums.
	 */
	responseChecksumValidation?: ChecksumMode | undefined;
	/** Resumable-upload tuning. */
	tus?:
		| {
				/** Preferred multipart part size in bytes; grown automatically when an upload would exceed the part limit. */
				chunkSize?: number | undefined;
		  }
		| undefined;
	/** Time allowed to establish a TCP connection. @defaultValue 5000 */
	connectionTimeout?: number | undefined;
	/** Time a socket may sit idle before the request is aborted. @defaultValue 120000 */
	socketTimeout?: number | undefined;
	/** Maximum concurrent sockets per host. @defaultValue 500 */
	maxSockets?: number | undefined;
	/** Reuse TCP connections between requests. @defaultValue true */
	keepAlive?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `s3` has its
 * options checked against {@link StorageDriverS3Config}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		s3: StorageDriverS3Config;
	}
}

/**
 * The parts S3 lists do not add up to the upload size: the one failure {@link StorageDriverS3.finishChunkedUpload}
 * retries, since the listing may simply lag behind the last write. Never leaves the driver; it becomes the TUS error
 * object once the retries are spent.
 *
 * @internal
 */
class PartsMismatchError extends Error {
	/**
	 * Create the error for a listing whose bytes do not add up to the upload size.
	 *
	 * @param listed - Bytes the listed parts add up to.
	 * @param expected - Total size of the upload.
	 */
	constructor(listed: number, expected: number) {
		// Named, so `shouldRetry` and the `catch` of `finishChunkedUpload` tell it from a failing `ListParts` call
		super(`S3 lists ${listed} of ${expected} bytes`);
		this.name = 'PartsMismatchError';
	}
}

/**
 * Storage driver backed by Amazon S3 or an S3-compatible service.
 *
 * Plain operations map one-to-one onto S3 commands. Resumable (TUS) uploads are built on S3 multipart uploads and
 * follow the S3 store of tus-node-server (https://github.com/tus/tus-node-server): each incoming chunk is split into
 * parts of at least the S3 minimum size, buffered on local disk and uploaded concurrently under a semaphore.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverS3 } from '@novastarter/storage-driver-s3';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('s3', StorageDriverS3);
 * storage.registerLocation('uploads', {
 * 	driver: 's3',
 * 	options: {
 * 		bucket: env.STORAGE_S3_BUCKET,
 * 		region: env.STORAGE_S3_REGION,
 * 		root: 'media',
 * 	},
 * });
 * ```
 */
export class StorageDriverS3 implements TusDriver {
	/**
	 * Options this instance was created with.
	 *
	 * @internal
	 */
	private config: StorageDriverS3Config;

	/**
	 * The location's `S3Client` of `@aws-sdk/client-s3` — the SDK's own API, with the location's credentials, region
	 * and endpoint — for what {@link StorageDriverS3.call} does not cover: presigned URLs, `@aws-sdk/lib-storage`
	 * uploads, paginators, waiters. One per driver, so its connection pool is shared with the storage methods.
	 *
	 * Keys given to it are not placed under the location's root, and the bucket is the caller's to name.
	 *
	 * @example
	 * ```ts
	 * import { GetObjectCommand } from '@aws-sdk/client-s3';
	 * import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
	 *
	 * const { client } = useStorage().location('s3') as StorageDriverS3;
	 * const command = new GetObjectCommand({ Bucket: 'uploads', Key: 'a.png' });
	 * const url = await getSignedUrl(client, command, { expiresIn: 60 });
	 * ```
	 */
	readonly client: S3Client;

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
	 * @throws InvalidConfigError when `bucket` is missing, when only one of `key` and `secret` is given, or when
	 * `tus.chunkSize` is below {@link StorageDriverS3.minPartSize}.
	 */
	constructor(config: StorageDriverS3Config) {
		// Every command targets the bucket, so a missing one would only fail on the first request, with an SDK
		// error that does not name the option
		if (!config.bucket) {
			throw new InvalidConfigError({ reason: 'The s3 storage driver needs a "bucket"' });
		}

		// Credential mistakes fail at construction instead of on the first request
		this.config = config;
		this.client = this.getClient();

		// S3 keys are not paths: a leading `/` would become part of the key and produce objects nobody can find by the
		// expected name. `confinePath` resolves `.` and `..` in the root the way every key is resolved, so a root of
		// `./media` strips from listed keys as `media` does, and a root of `/` means the top of the bucket
		this.root = this.config.root ? confinePath(this.config.root) : '';

		// A preferred part size below the S3 minimum would make the splitter cut every part but the last too small
		// to be sent, so no upload could ever advance; refused here, with the minimum named, rather than on the
		// first PATCH. Written so that `NaN` fails the check too
		const chunkSize = config.tus?.chunkSize;

		if (chunkSize !== undefined && !(chunkSize >= this.minPartSize)) {
			throw new InvalidConfigError({
				reason: `The s3 storage driver needs a "tus.chunkSize" of at least ${this.minPartSize} bytes`,
			});
		}

		// Sixty concurrent part uploads is the tus-node-server default, a balance between throughput and the
		// number of open sockets and temp files
		this.preferredPartSize = chunkSize ?? this.minPartSize;
		this.partUploadSemaphore = new Semaphore(60);
	}

	/**
	 * Build the SDK client from the driver options.
	 *
	 * @returns A configured client.
	 * @throws InvalidConfigError when only one of `key` and `secret` is given.
	 * @internal
	 */
	private getClient() {
		// The SDK's default agent caps at 50 sockets, so bursts of requests would queue behind that limit. `ms` accepts
		// both plain milliseconds and duration strings, so timeouts from untyped configuration still resolve to a
		// number
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

		// Half a credential pair is a configuration error, never an intent to fall back to the SDK provider chain
		if ((this.config.key && !this.config.secret) || (this.config.secret && !this.config.key)) {
			throw new InvalidConfigError({ reason: 'The s3 storage driver needs "key" and "secret" together' });
		}

		// Without explicit credentials the SDK resolves them from the environment, shared config or instance metadata
		if (this.config.key && this.config.secret) {
			s3ClientConfig.credentials = {
				accessKeyId: this.config.key,
				secretAccessKey: this.config.secret,
			};
		}

		// The URL parser keeps the path prefix of a service mounted under one and puts a port in the SDK's own `port`
		// field instead of inside `hostname`. `https` is assumed when no scheme is given, because only local setups run
		// S3-compatible services over plain `http`
		if (this.config.endpoint) {
			const endpoint = new URL(
				this.config.endpoint.startsWith('http://') || this.config.endpoint.startsWith('https://')
					? this.config.endpoint
					: `https://${this.config.endpoint}`,
			);

			s3ClientConfig.endpoint = {
				hostname: endpoint.hostname,
				protocol: endpoint.protocol,
				path: endpoint.pathname,
				...(endpoint.port ? { port: Number(endpoint.port) } : {}),
			};
		}

		// Unset, region and path style leave the SDK its own defaults and environment lookups
		if (this.config.region) {
			s3ClientConfig.region = this.config.region;
		}

		if (this.config.forcePathStyle !== undefined) {
			s3ClientConfig.forcePathStyle = this.config.forcePathStyle;
		}

		// Checksum policies are forwarded only when configured, so AWS proper keeps the SDK's integrity defaults
		// and only services that lack flexible checksums (Cloudflare R2, older MinIO/Ceph) opt out
		if (this.config.requestChecksumCalculation) {
			s3ClientConfig.requestChecksumCalculation = this.config.requestChecksumCalculation;
		}

		if (this.config.responseChecksumValidation) {
			s3ClientConfig.responseChecksumValidation = this.config.responseChecksumValidation;
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
		// The caller path is confined before joining: resolved against `/` first, a leading `..` has nothing to climb
		// and is dropped, so `../other/secret` cannot address a key outside the location. `joinPath` copes with an
		// empty root and doubled slashes and always produces the forward slashes S3 keys use
		return joinPath(this.root, confinePath(filepath));
	}

	/**
	 * Stream an object's contents.
	 *
	 * @param filepath - Object path relative to the root.
	 * @param options - Optional byte range; `version` is not supported by this driver and is ignored.
	 * @returns The response body as a Node stream.
	 * @throws Error when S3 returns no body, or a body that is not a Node readable.
	 * @throws StorageFileNotFoundError when S3 answers 404.
	 * @throws The SDK error for any other failure, or an `Error` when the SDK hands back no Node stream.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range } = options ?? {};

		const commandInput: GetObjectCommandInput = {
			Key: this.fullPath(filepath),
			Bucket: this.config.bucket,
		};

		// An omitted start is `0`: `{ end }` alone asks for the first bytes up to `end`, where `bytes=-N` would mean
		// the last N bytes. An omitted end is left open
		if (range) {
			commandInput.Range = `bytes=${range.start ?? 0}-${range.end ?? ''}`;
		}

		// A 404 — `NoSuchKey` — is the error every backend shares, so a caller tells a missing object from a denied
		// or failed read; anything else says nothing about the object and is rethrown
		let stream: GetObjectCommandOutput['Body'];

		try {
			({ Body: stream } = await this.client.send(new GetObjectCommand(commandInput)));
		} catch (error) {
			if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// The SDK types the body as a union of Node, Web and blob streams; only a Node readable is usable by the
		// rest of the storage layer, so anything else counts as a failed read
		if (!stream || !isReadableStream(stream)) {
			throw new Error(`The s3 storage driver got no stream for file "${filepath}"`);
		}

		return stream as Readable;
	}

	/**
	 * Read an object's size and last-modified time through a HEAD request.
	 *
	 * @param filepath - Object path relative to the root.
	 * @returns Size in bytes and modification date.
	 * @throws StorageFileNotFoundError when S3 answers 404.
	 * @throws The SDK error for any other failure, such as denied credentials or a timeout.
	 */
	async stat(filepath: string): Promise<Stat> {
		let head: HeadObjectCommandOutput;

		// HEAD returns the metadata without transferring the body, which is all this call needs. A HEAD response has
		// no body, so 404 is the only answer that confirms the object is missing; it becomes the error every backend
		// shares, anything else says nothing about the object and is rethrown
		try {
			head = await this.client.send(
				new HeadObjectCommand({
					Key: this.fullPath(filepath),
					Bucket: this.config.bucket,
				}),
			);
		} catch (error) {
			if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// Both fields are optional in the SDK's types; a HEAD response without one is a broken answer and is refused
		// here rather than handed out as `undefined` under the non-optional `Stat` type
		if (head.ContentLength === undefined || head.LastModified === undefined) {
			throw new Error(`The s3 storage driver got no stat for file "${filepath}"`);
		}

		return {
			size: head.ContentLength,
			modified: head.LastModified,
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
		// A successful HEAD is proof of existence
		try {
			await this.stat(filepath);
			return true;
		} catch (error) {
			// `stat` already reduced a 404 to the kit's "not found"; treating any other failure as missing would make
			// callers act on a wrong answer
			if (error instanceof StorageFileNotFoundError) return false;

			throw error;
		}
	}

	/**
	 * Move an object by copying it to the new key and deleting the old one.
	 *
	 * S3 has no rename, so this takes two requests and is not atomic: a failure after the copy leaves both objects in
	 * place. A move onto the key the source already resolves to does nothing.
	 *
	 * @param src - Current object path.
	 * @param dest - Path to move the object to.
	 */
	async move(src: string, dest: string): Promise<void> {
		// Paths such as `a.png` and `./a.png` resolve to the same key; with encryption configured S3 accepts the
		// copy onto itself, and the delete that follows would then remove the only copy, so such a move is a no-op
		if (this.fullPath(src) === this.fullPath(dest)) return;

		// Copying before deleting means a failure at any point never loses the data
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
		// `CopySource` is a URL-style `/bucket/key` reference, unlike the plain `Key` used for the target, and S3
		// reads it URL-encoded: a `+` would be taken for a space, a `%` for an escape, a `?` for the version query,
		// so every segment of the key is encoded — the slashes between them stay
		const params: CopyObjectCommandInput = {
			Key: this.fullPath(dest),
			Bucket: this.config.bucket,
			CopySource: `/${this.config.bucket}/${this.fullPath(src).split('/').map(encodeURIComponent).join('/')}`,
		};

		// S3 does not carry encryption or ACL over from the source object; both have to be restated on the copy
		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (KMS_KEY_ID_MODES.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
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

		// Unset headers leave the bucket defaults in place
		if (type) {
			params.ContentType = type;
		}

		if (this.config.acl) {
			params.ACL = this.config.acl;
		}

		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (KMS_KEY_ID_MODES.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		// `Upload` from lib-storage streams a body of unknown length as a multipart upload; a plain
		// `PutObjectCommand` needs the content length up front, which a stream cannot provide
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
		// No `VersionId` is passed: the driver never enables versioning, so the plain delete removes the current object
		await this.client.send(
			new DeleteObjectCommand({
				Key: this.fullPath(filepath),
				Bucket: this.config.bucket,
			}),
		);
	}

	/**
	 * Run any S3 command by its name with the location's client, credentials, bucket and a timeout — the way to what
	 * the storage contract does not cover: versioning, lifecycle rules, bucket policies, CORS, tagging.
	 *
	 * `method` is the name of a command of `@aws-sdk/client-s3`, with or without its `Command` suffix; `params` is the
	 * command's input, in the SDK's field names, and `Bucket` defaults to the location's bucket. Keys in `params` are
	 * sent as given, not placed under the location's root. For anything beyond one command — presigned URLs, streamed
	 * uploads, extra headers — use {@link StorageDriverS3.client}.
	 *
	 * @typeParam T - The command's output; the caller knows it from the SDK's documentation.
	 * @param method - The command: `GetBucketVersioning`, `PutBucketLifecycleConfiguration`, `HeadBucketCommand`.
	 * @param params - The command's input; `Bucket` is the location's unless given.
	 * @param options - A timeout over the default 30 s and an abort signal; `headers` — the call's or the location's —
	 * are refused rather than dropped, the SDK building the request itself.
	 * @returns The HTTP status, no headers — the SDK does not hand them out — and the command's output, without the
	 * SDK's `$metadata`.
	 * @throws ProviderCallError when S3 answers with an error status — its status and `{ name, message }` in
	 * `extensions`.
	 * @throws HitRateLimitError when S3 answers 429 or asks to slow down — a 503 `SlowDown`.
	 * @throws TimeoutError when the command outlives its timeout.
	 * @throws InvalidPayloadError when the SDK has no command of that name, or headers are given.
	 * @example
	 * ```ts
	 * const { data } = await s3.call<{ Status?: string }>('GetBucketVersioning');
	 *
	 * await s3.call('PutBucketVersioning', { VersioningConfiguration: { Status: 'Enabled' } });
	 *
	 * const { status } = await s3.call('HeadBucket');
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options: CallOptions = {},
	): Promise<CallResponse<T>> {
		// Headers — the call's or the location's `call.headers` — cannot reach the SDK's signed request; refused
		// rather than silently dropped
		if (Object.keys(options.headers ?? {}).length > 0) {
			throw new InvalidPayloadError({ reason: 'The s3 call() sends no extra headers; use the SDK client' });
		}

		// Only the SDK's own exports are looked up, so a name that is not a command there is refused before anything is
		// sent
		const name = method.trim().replace(/Command$/, '');

		const Command = /^[A-Z][A-Za-z0-9]*$/.test(name)
			? (s3 as unknown as Record<string, unknown>)[`${name}Command`]
			: undefined;

		if (typeof Command !== 'function') {
			throw new InvalidPayloadError({
				reason: `The s3 call method "${method}" is not a command of @aws-sdk/client-s3`,
			});
		}

		// A command without a bucket ignores the field
		const command = new (Command as S3CommandConstructor)({ Bucket: this.config.bucket, ...params });

		// The SDK takes the abort signal, so a timed-out request really stops
		let output: Record<string, unknown>;

		try {
			output = (await withTimeout(
				(abortSignal) => this.client.send(command, { abortSignal }),
				options.timeout ?? DEFAULT_REQUEST_TIMEOUT,
				options.signal ? { signal: options.signal } : {},
			)) as unknown as Record<string, unknown>;
		} catch (error) {
			// S3 says "slow down" with a 503 `SlowDown`, other AWS services with throttling codes: each becomes the
			// kit's 429. The SDK's error is not kept as the cause, so nothing of the request goes into the error; a
			// timeout, an abort or a network failure is passed on as it is
			if (error instanceof S3ServiceException) {
				const status = error.$metadata?.httpStatusCode ?? 500;

				throw toProviderCallError({
					provider: 's3',
					method,
					status: S3_THROTTLING_ERRORS.includes(error.name) ? 429 : status,
					body: { name: error.name, message: error.message },
				});
			}

			throw error;
		}

		// The SDK's request metadata is not part of the documented output, but its status is the answer's
		const { $metadata: metadata, ...data } = output as { $metadata?: { httpStatusCode?: number } };

		return { status: metadata?.httpStatusCode ?? 200, headers: {}, data: data as T };
	}

	/**
	 * Release the SDK client's connection pool; the process is shutting down.
	 *
	 * @returns Once the client is destroyed.
	 */
	async close(): Promise<void> {
		// The SDK keeps sockets alive between calls, which keeps the process up once nothing else does
		this.client.destroy();
	}

	/**
	 * Enumerate object paths under a prefix, page by page.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root. Keys ending in `/` (folder placeholders) are skipped.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// The trailing slash keeps `media` from matching `media-archive/…`; no root and no prefix give an empty string,
		// which lists the whole bucket
		const Prefix = toListPrefix(this.fullPath(prefix), prefix);

		let continuationToken: string | undefined = undefined;

		// S3 returns at most 1000 keys per call, hence the continuation token. Yielding inside the loop keeps memory
		// flat for large buckets
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

			// Folder placeholders are skipped and the root stripped, so callers get paths in the form they pass in
			if (response.Contents) {
				for (const object of response.Contents) {
					if (!object.Key) continue;

					const isDir = object.Key.endsWith('/');

					if (isDir) continue;

					yield toRelativePath(this.root, object.Key);
				}
			}
		} while (continuationToken);
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// Only the extensions the chunked-upload methods back are advertised: `creation` maps to
		// `createChunkedUpload`, `termination` to `deleteChunkedUpload`, and `expiration` lets the server announce
		// when an unfinished multipart upload may be discarded. Checksum and concatenation are left out because a
		// part checksum is verified only when the upload is completed, and parts of several uploads cannot be
		// joined into one
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start an S3 multipart upload for a resumable upload.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Client-supplied size and metadata; the `contentType` and `cacheControl` keys are forwarded to
	 * S3.
	 * @returns The same context with the multipart `upload-id` stored in its metadata for the following calls; the
	 * metadata map is created when the context has none.
	 * @throws The SDK error when S3 refuses to create the multipart upload.
	 */
	async createChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// A POST without `Upload-Metadata` arrives with no map at all; it is created before the request, so the
		// upload id always has a place to go and an upload S3 already opened is never lost to a `TypeError`
		const metadata = (context.metadata ??= {});

		// S3 only accepts the TUS tag and the content headers when the multipart upload is created, not when it is
		// completed
		const params: CreateMultipartUploadCommandInput = {
			Bucket: this.config.bucket,
			Key: this.fullPath(filepath),
			Metadata: { 'tus-version': TUS_RESUMABLE },
			...(metadata['contentType'] ? { ContentType: metadata['contentType'] } : {}),
			...(metadata['cacheControl'] ? { CacheControl: metadata['cacheControl'] } : {}),
		};

		// The KMS key id is only valid for the KMS modes, as in a plain write
		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (KMS_KEY_ID_MODES.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		// S3 takes the canned ACL only when the multipart upload is created, not when it is completed
		if (this.config.acl) {
			params.ACL = this.config.acl;
		}

		// S3 assigns the id every later part refers to, so nothing can be sent before it exists
		const res = await this.client.send(new CreateMultipartUploadCommand(params));

		// The upload id is the only handle S3 gives for adding parts, and the context is what the TUS server hands back
		// on every later call
		metadata['upload-id'] = res.UploadId!;

		return context;
	}

	/**
	 * Abort a resumable upload, or remove the object it produced when it was completed before.
	 *
	 * An upload that is still open never touched the key: S3 only writes the object when the multipart upload is
	 * completed, so whatever sits under the key then is the file the upload was meant to replace, and it is kept. An
	 * upload that was completed or aborted before no longer exists for S3, while the object assembled from it does,
	 * so a termination after completion still removes the file.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Context carrying the multipart `upload-id`.
	 * @throws `ERRORS.FILE_NOT_FOUND` from `@tus/utils` when neither the upload nor an object under the key exists, so
	 * the TUS server answers 404 instead of 500.
	 * @throws The SDK error when the abort, the lookup or the delete fails for any other reason.
	 */
	async deleteChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const key = this.fullPath(filepath);
		const uploadId = context.metadata?.['upload-id'];

		// S3 keeps (and bills for) uploaded parts until the upload is completed or aborted
		if (uploadId) {
			try {
				await this.client.send(
					new AbortMultipartUploadCommand({
						Bucket: this.config.bucket,
						Key: key,
						UploadId: uploadId,
					}),
				);

				// The upload was still open, so it never wrote the key: an object there predates the upload and
				// deleting it would destroy the file a cancelled replacement was meant to overwrite
				return;
			} catch (error) {
				// The S3 "missing" family of errors means the upload was completed or aborted before, which leaves
				// only the object to remove; anything else is a real failure. The SDK names the error in `name` —
				// `NoSuchUpload`, `NoSuchKey`, or `NotFound` for a bodiless 404 — and reports the status in
				// `$metadata`; it never sets a lowercase `code`
				const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };

				if ($metadata?.httpStatusCode !== 404 && !['NotFound', 'NoSuchKey', 'NoSuchUpload'].includes(name ?? '')) {
					throw error;
				}
			}
		}

		// With no upload to abort, the object under the key is all that can be left; when that is missing too,
		// the TUS server answers 404. The delete cannot tell, since S3 reports a missing key as deleted
		if (!(await this.exists(filepath))) {
			throw ERRORS.FILE_NOT_FOUND;
		}

		// Removing the object keeps a termination after a completed upload from leaving the file behind. The
		// single-object delete is used because it throws on a failure such as AccessDenied, where the batch
		// `DeleteObjects` answers 200 and only lists the failure in `Errors`, which would report a false success
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.config.bucket,
				Key: key,
			}),
		);
	}

	/**
	 * Complete the multipart upload once every part has arrived.
	 *
	 * A zero-length upload produces no parts, and S3 refuses `CompleteMultipartUpload` with an empty `Parts` list
	 * (400 MalformedXML), so its multipart upload is aborted and the empty object is written with a plain
	 * `PutObjectCommand` instead.
	 *
	 * Only the unbroken run of parts from part 1 that adds up to the size is completed; parts past it, left by a chunk
	 * that failed half-way and was never resent that far, are discarded by S3.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param context - Context carrying the multipart `upload-id` and the total `size`.
	 * @throws Error when the context carries no upload id or no size, meaning the upload was never created by
	 * {@link StorageDriverS3.createChunkedUpload}.
	 * @throws An object with `status_code: 500` when the parts S3 lists still do not add up to the upload size after
	 * three retries, in the shape the TUS server turns into an HTTP response.
	 * @throws The SDK error when the abort or the empty-object write of a zero-length upload, the listing, or the
	 * completion request fails.
	 */
	async finishChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const key = this.fullPath(filepath);

		// The upload id and the total size are put into the context by `createChunkedUpload`; a context without
		// them means the calls arrived out of order, and an explicit error says so where a non-null assertion
		// would surface a `TypeError` naming nothing
		const uploadId = context.metadata?.['upload-id'];

		if (uploadId === undefined || uploadId === null) {
			throw new Error(
				`The s3 storage driver cannot finish the chunked upload of "${filepath}": the context has no upload id`,
			);
		}

		const size = context.size;

		if (size === undefined) {
			throw new Error(
				`The s3 storage driver cannot finish the chunked upload of "${filepath}": the context has no upload size`,
			);
		}

		// A zero-length upload produces no parts, and S3 refuses `CompleteMultipartUpload` with an empty `Parts`
		// list (400 MalformedXML): the multipart upload is aborted and the empty object is written directly,
		// restating the headers the create request carried
		if (size === 0) {
			// The multipart upload is abandoned before the object exists, so no part can land in it afterwards and
			// S3 stops holding (and billing for) stored parts
			await this.client.send(
				new AbortMultipartUploadCommand({
					Bucket: this.config.bucket,
					Key: key,
					UploadId: uploadId,
				}),
			);

			const params: PutObjectCommandInput = {
				Bucket: this.config.bucket,
				Key: key,
				Body: Buffer.alloc(0),
			};

			// The client-sent headers travel with the create request on the multipart path, so they are copied out
			// of the context here; a key sent without a value is `null` and is skipped, like `createChunkedUpload`
			// skips it
			const contentType = context.metadata?.['contentType'];

			if (contentType) {
				params.ContentType = contentType;
			}

			const cacheControl = context.metadata?.['cacheControl'];

			if (cacheControl) {
				params.CacheControl = cacheControl;
			}

			// The KMS key id is only valid for the KMS modes, as in `createChunkedUpload`
			if (this.config.serverSideEncryption) {
				params.ServerSideEncryption = this.config.serverSideEncryption;

				if (KMS_KEY_ID_MODES.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
					params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
				}
			}

			// The object is created by this request, so the canned ACL goes here, as in `createChunkedUpload`
			if (this.config.acl) {
				params.ACL = this.config.acl;
			}

			await this.client.send(new PutObjectCommand(params));

			return;
		}

		// The listing may not yet show the last parts, hence the growing pauses (0.5 s, 1 s, 1.5 s). Only a listing
		// that does not add up is retried: a failing `ListParts` call is a real error and goes out at once
		let parts: Part[];

		try {
			parts = await retry(
				async () => {
					// Parts are checked by their bytes, not their count: a client whose requests do not line up with
					// the part size leaves parts of uneven sizes, so only the byte total says whether every part is in.
					// Only the unbroken run from part 1 counts: parts past it are leftovers of a chunk that failed
					// half-way, and completing without them makes S3 discard them
					const stored = this.storedPrefix(await this.retrieveParts(key, uploadId), size);

					if (stored.bytes !== size) {
						throw new PartsMismatchError(stored.bytes, size);
					}

					return stored.parts;
				},
				{
					retries: 3,
					delay: (attempt) => 500 * attempt,
					shouldRetry: (error) => error instanceof PartsMismatchError,
				},
			);
		} catch (error) {
			// Completing with a part missing would produce a truncated object, so refuse in the shape the TUS server
			// turns into an HTTP response and let the client retry
			if (error instanceof PartsMismatchError) {
				throw {
					status_code: 500,
					body: 'Failed to upload all parts to S3.',
				};
			}

			throw error;
		}

		// Every byte is accounted for, so S3 can assemble the object from the parts in the order of the listing
		await this.finishMultipartUpload(key, uploadId, parts);
	}

	/**
	 * Upload one TUS chunk as one or more multipart parts.
	 *
	 * When a part upload fails the chunk throws and the offset stays where it was, even if other parts of the chunk
	 * reached S3. The parts are numbered from `offset`, so the resent chunk overwrites those parts instead of adding the
	 * same bytes again, and {@link StorageDriverS3.finishChunkedUpload} leaves out any that were never overwritten.
	 *
	 * @param filepath - Final object path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param context - Context carrying the multipart `upload-id` and the total `size`, which is `undefined` while the
	 * client defers the length.
	 * @returns The new upload offset: `offset` plus the bytes that reached S3.
	 * @throws Error when the context carries no upload id, meaning the upload was never created by
	 * {@link StorageDriverS3.createChunkedUpload}.
	 * @throws An object with `status_code: 400`, in the shape the TUS server turns into an HTTP response, when the
	 * chunk carried bytes but not one of them could be sent: every part but the last has to reach
	 * {@link StorageDriverS3.minPartSize}, so a client sending less per request would never advance.
	 * @throws The SDK error from the part listing, or the first error raised by the splitter pipeline or a part
	 * upload, as raised by {@link StorageDriverS3.uploadParts}.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		const key = this.fullPath(filepath);

		// The upload id is put into the context by `createChunkedUpload`; a context without it means the calls
		// arrived out of order, and an explicit error says so where a non-null assertion would surface a `TypeError`
		// naming nothing. The size stays `undefined` for a deferred-length upload: parts are then sized for the
		// largest object S3 allows, and only the chunk that arrives after the client declared the length is
		// recognised as the final one
		const uploadId = context.metadata?.['upload-id'];

		if (uploadId === undefined || uploadId === null) {
			throw new Error(`The s3 storage driver cannot write a chunk of "${filepath}": the context has no upload id`);
		}

		const size = context.size;

		// Part numbers must be increasing within an upload; ask S3 which parts exist instead of keeping a counter,
		// so a resumed upload continues from the right number. The number follows the parts that hold exactly the
		// bytes before `offset`: a chunk that failed half-way may have left parts past that point, and uploading
		// under their numbers overwrites them instead of storing the resent bytes a second time. Only when the
		// listing does not reach `offset` (a lagging listing) does the number follow the highest listed part
		const parts = await this.retrieveParts(key, uploadId);
		const stored = this.storedPrefix(parts, offset);

		const highestPartNumber: number = parts.length > 0 ? parts[parts.length - 1]!.PartNumber! : 0;
		const partNumber: number = stored.bytes === offset ? stored.parts.length : highestPartNumber;

		const nextPartNumber = partNumber + 1;
		const requestedOffset = offset;

		// Report what actually reached S3 rather than the chunk length: a chunk that ended mid-part is not counted,
		// and the client resends those bytes on its next request
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
		// The body is a stream over the temp file rather than the network chunk: the SDK sizes the request from the
		// file, which a live stream cannot provide
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
	 * @param size - Total size of the upload, used to size parts and to recognise the final one; `undefined` while the
	 * client defers the length, in which case every part but a trailing short one is sent and no part is treated as
	 * the final one.
	 * @param readStream - Chunk data.
	 * @param currentPartNumber - Part number assigned to the first part produced.
	 * @param offset - Upload offset at the start of the chunk.
	 * @returns Bytes accepted by S3 from this chunk.
	 * @throws An object with `status_code: 400`, in the shape the TUS server turns into an HTTP response, when the
	 * chunk carried bytes but not one of them could be sent: the offset would not move, and the client would resend
	 * the same too-short chunk forever.
	 * @throws The first error raised by the splitter pipeline or by a part upload.
	 * @internal
	 */
	private async uploadParts(
		key: string,
		uploadId: string,
		size: number | undefined,
		readStream: stream.Readable,
		currentPartNumber: number,
		offset: number,
	): Promise<number> {
		const promises: Promise<void>[] = [];
		let pendingChunkFilepath: string | null = null;
		let bytesReceived = 0;
		let bytesUploaded = 0;
		let permit: Permit | undefined = undefined;
		let aborted = false;

		// The handlers below upload each part as soon as it is on disk, while later parts are still being written
		const splitterStream = new StreamSplitter({
			chunkSize: this.calcOptimalPartSize(size),
			directory: os.tmpdir(),
		})
			.on('beforeChunkStarted', async () => {
				// The permit comes before a part is buffered, so disk usage stays bounded along with the number of
				// in-flight uploads
				const granted = await this.partUploadSemaphore.acquire();

				// The pipeline may have failed while the permit was pending: no handler will ever consume this
				// part, so the permit goes straight back and the splitter is stopped here, before it opens a temp
				// file nobody would close or remove. The error only reaches a stream that is already destroyed
				if (aborted) {
					await granted.release();

					throw new Error('The s3 storage driver upload failed while a part waited for a permit');
				}

				permit = granted;
			})
			.on('chunkStarted', (filepath) => {
				// Remembered so the file can be removed if the pipeline fails mid-part
				pendingChunkFilepath = filepath;
			})
			.on('chunkFinished', ({ path, size: partSize }) => {
				// The part file is complete, so the error path no longer has anything to clean up for it
				pendingChunkFilepath = null;

				// Capture the part number and permit now: this handler runs once per part, and the shared
				// variables move on before the upload below finishes
				const partNumber = currentPartNumber++;
				const acquiredPermit = permit;

				// The shared slot is cleared the moment the permit is captured: `chunkError` releases whatever sits
				// in it, and a permit already handed to an in-flight upload would be released a second time from
				// there, inflating the semaphore past its cap
				permit = undefined;

				offset += partSize;
				bytesReceived += partSize;

				// A part is the final one only when the declared size is reached: while the client defers the length
				// no part can be recognised as final, so a trailing part under the S3 minimum is skipped like any
				// other non-final one and the client resends those bytes once the length is known
				const isFinalPart = size !== undefined && size === offset;

				// Awaiting here would serialise the parts
				// eslint-disable-next-line no-async-promise-executor
				const deferred = new Promise<void>(async (resolve, reject) => {
					let readable: fs.ReadStream | undefined;

					try {
						// S3 rejects a part under the minimum size unless it is the last one, so a short trailing
						// part is skipped and left uncounted: the returned offset then makes the client resend it.
						// The file is opened only for a part that is sent, since a stream nobody reads would hold
						// its descriptor until the process exits
						if (partSize >= this.minPartSize || isFinalPart) {
							readable = fs.createReadStream(path);
							readable.on('error', reject);

							await this.uploadPart(key, uploadId, readable, partNumber);
							bytesUploaded += partSize;
						}

						resolve();
					} catch (error) {
						reject(error);
					} finally {
						// A rejected `UploadPart` leaves the body half-read, so the stream is destroyed to close its
						// descriptor before the file goes; a failed removal is not worth failing the upload over.
						// Releasing the permit lets the next part start
						readable?.destroy();
						fsProm.rm(path).catch(() => {});
						acquiredPermit?.release();
					}
				});

				promises.push(deferred);

				// Handle a rejection the moment it happens instead of leaving the promise bare until `Promise.all`
				// subscribes in the `finally` below: the chunk can keep streaming for many event-loop turns before
				// the pipeline settles, and Node's default `unhandledRejection: 'throw'` would crash the process on
				// the first part-upload failure long before that. This catch only marks the rejection as handled on
				// its own chain — `Promise.all` still rethrows the error to the caller once every upload has settled
				deferred.catch(() => {});
			})
			.on('chunkError', () => {
				// A splitter failure never reaches `chunkFinished`, so the permit taken for the part being written is
				// still in the shared slot and is freed here; a permit already captured by `chunkFinished` is no
				// longer in the slot and is released by that part's own upload, and one still pending is turned back
				// by `beforeChunkStarted` once it is granted
				aborted = true;
				permit?.release();
			});

		// Every part upload is queued by the time this resolves
		try {
			await streamProm.pipeline(readStream, splitterStream);
		} catch (error) {
			aborted = true;

			if (pendingChunkFilepath !== null) {
				try {
					await fsProm.rm(pendingChunkFilepath);
				} catch (cleanupError) {
					// The pipeline error is the one worth throwing; a temp file left behind is only worth a warning
					useLogger().warn(cleanupError, `Failed to remove chunk "${pendingChunkFilepath}" after an upload error`);
				}
			}

			promises.push(Promise.reject(error));
		} finally {
			// Every queued upload is awaited, so the returned byte count reflects what actually reached S3
			await Promise.all(promises);
		}

		// A chunk that finished cleanly with every byte left unsent would come back unchanged, since the offset
		// does not move; refuse it in the shape the TUS server turns into an HTTP response, naming the size a
		// request has to reach
		if (bytesReceived > 0 && bytesUploaded === 0) {
			throw {
				status_code: 400,
				body: `A chunk of ${bytesReceived} bytes cannot be stored: every request but the last has to carry at least ${this.minPartSize} bytes.`,
			};
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
		// S3 is the only record of which parts exist, since the driver keeps no counter of its own between calls
		const data = await this.client.send(
			new ListPartsCommand({
				Bucket: this.config.bucket,
				Key: key,
				UploadId: uploadId,
				PartNumberMarker: partNumberMarker!,
			}),
		);

		let parts = data.Parts ?? [];

		// S3 pages the listing; recursing with the marker gives callers the complete set
		if (data.IsTruncated) {
			const rest = await this.retrieveParts(key, uploadId, data.NextPartNumberMarker);
			parts = [...parts, ...rest];
		}

		// Sort once at the outermost call: `CompleteMultipartUpload` requires ascending part numbers, and
		// `storedPrefix` and `writeChunk` walk the parts in that order
		if (!partNumberMarker) {
			parts.sort((a, b) => a.PartNumber! - b.PartNumber!);
		}

		return parts;
	}

	/**
	 * Take the unbroken run of parts from part 1 that holds the first `limit` bytes of the upload.
	 *
	 * Parts are walked in ascending order while their numbers follow on from each other and their bytes stay below
	 * `limit`. A failed chunk can leave parts past the point the upload offset reached; stopping at `limit` keeps them
	 * out, so they are overwritten by the resent bytes or left out of the completed object.
	 *
	 * @param parts - Parts in ascending order, as returned by {@link StorageDriverS3.retrieveParts}.
	 * @param limit - Number of leading upload bytes the run should cover.
	 * @returns The parts of the run and the bytes they hold; `bytes` differs from `limit` when the listed parts do not
	 * add up to exactly `limit` bytes.
	 * @internal
	 */
	private storedPrefix(parts: Part[], limit: number): { parts: Part[]; bytes: number } {
		const run: Part[] = [];
		let bytes = 0;

		// Stop at the first gap in the numbering: bytes after a missing part are not in upload order, so they cannot
		// count towards the offset
		for (const part of parts) {
			if (bytes >= limit || part.PartNumber !== run.length + 1) {
				break;
			}

			run.push(part);
			bytes += part.Size ?? 0;
		}

		return { parts: run, bytes };
	}

	/**
	 * Tell S3 to assemble the uploaded parts into the final object.
	 *
	 * @param key - Object key of the upload.
	 * @param uploadId - Multipart upload id.
	 * @param parts - Parts in ascending order, as returned by {@link StorageDriverS3.retrieveParts}.
	 * @returns The URL S3 reports for the assembled object.
	 * @internal
	 */
	private async finishMultipartUpload(key: string, uploadId: string, parts: Part[]) {
		// The completion request takes only ETag and PartNumber per part; the size and timestamps from the listing
		// are dropped
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
		// Without a known length, plan for the largest object S3 allows so the part count can never overflow
		if (size === undefined) {
			size = this.maxUploadSize;
		}

		let optimalPartSize: number;

		// A small upload goes in a single part; the S3 minimum only applies to parts that are not the last
		if (size <= this.preferredPartSize) {
			optimalPartSize = size;
		}
		// The preferred size works as long as the upload fits in the maximum number of parts
		else if (size <= this.preferredPartSize * this.maxMultipartParts) {
			optimalPartSize = this.preferredPartSize;
		} else {
			optimalPartSize = Math.ceil(size / this.maxMultipartParts);
		}

		return optimalPartSize;
	}
}
