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
	DeleteObjectsCommand,
	GetObjectCommand,
	type GetObjectCommandOutput,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	S3Client,
	S3ServiceException,
	ServerSideEncryption,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { toProviderCallError } from '@novastarter/errors';
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
import { type CallOptions, confinePath, joinPath, retry, withTimeout } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { Permit, Semaphore } from '@shopify/semaphore';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ERRORS, StreamSplitter, TUS_RESUMABLE } from '@tus/utils';
import ms, { type StringValue } from 'ms';
import type { ChecksumMode } from '../types.js';
import { KMS_KEY_ID_MODES } from './constants.js';

/**
 * How long a {@link StorageDriverS3.call} may take when the caller names no timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_S3_CALL_TIMEOUT = 30_000;

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
		// 1. Named, so `shouldRetry` and the `catch` of `finishChunkedUpload` tell it from a failing `ListParts` call
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
	 * @throws Error when `bucket` is missing, when only one of `key` and `secret` is given, or when `tus.chunkSize` is
	 * below {@link StorageDriverS3.minPartSize}.
	 */
	constructor(config: StorageDriverS3Config) {
		// 1. Every command targets the bucket, so a missing one would only fail on the first request, with an SDK
		//    error that does not name the option
		if (!config.bucket) {
			throw new Error('The s3 storage driver needs a "bucket"');
		}

		// 2. Build the client up front, so credential mistakes fail at construction instead of on the first request
		this.config = config;
		this.client = this.getClient();

		// 3. Store the root without a leading slash: S3 keys are not paths, and a leading `/` would become part of
		//    the key and produce objects nobody can find by the expected name
		//    `confinePath` also resolves `.` and `..` in the root, the way every key is resolved, so a root of `./media`
		//    strips from listed keys as `media` does, and a root of `/` means the top of the bucket
		this.root = this.config.root ? confinePath(this.config.root) : '';

		// 4. A preferred part size below the S3 minimum would make the splitter cut every part but the last too small
		//    to be sent, so no upload could ever advance; refused here, with the minimum named, rather than on the
		//    first PATCH. Written so that `NaN` fails the check too
		const chunkSize = config.tus?.chunkSize;

		if (chunkSize !== undefined && !(chunkSize >= this.minPartSize)) {
			throw new Error(`The s3 storage driver needs a "tus.chunkSize" of at least ${this.minPartSize} bytes`);
		}

		// 5. Sixty concurrent part uploads is the tus-node-server default, a balance between throughput and the
		//    number of open sockets and temp files
		this.preferredPartSize = chunkSize ?? this.minPartSize;
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
			throw new Error('The s3 storage driver needs "key" and "secret" together');
		}

		// 3. Pass explicit credentials only when both halves exist; otherwise the SDK resolves them from the
		//    environment, shared config or instance metadata
		if (this.config.key && this.config.secret) {
			s3ClientConfig.credentials = {
				accessKeyId: this.config.key,
				secretAccessKey: this.config.secret,
			};
		}

		// 4. Parse a custom endpoint with the URL parser so a service mounted under a path prefix keeps the prefix and a
		//    port lands in the SDK's own `port` field instead of inside `hostname`. `https` is assumed when no scheme is
		//    given, because only local setups run S3-compatible services over plain `http`
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

		// 5. Region and path style are only set when configured, so the SDK keeps its own defaults and environment
		//    lookups otherwise
		if (this.config.region) {
			s3ClientConfig.region = this.config.region;
		}

		if (this.config.forcePathStyle !== undefined) {
			s3ClientConfig.forcePathStyle = this.config.forcePathStyle;
		}

		// 6. Checksum policies are forwarded only when configured, so AWS proper keeps the SDK's integrity defaults
		//    and only services that lack flexible checksums (Cloudflare R2, older MinIO/Ceph) opt out
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
		// 1. Pin the caller path under the root before joining: resolved against `/` first, a leading `..` has nothing
		//    to climb and is dropped by `confinePath`, so `../other/secret` cannot address a key outside the location. `joinPath`
		//    copes with an empty root and doubled slashes and always produces the forward slashes S3 keys use
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

		// 1. Translate the range into the HTTP header form: an omitted start is `0` — `{ end }` alone asks for the
		//    first bytes up to `end`, where `bytes=-N` would mean the last N bytes — and an omitted end is left open
		if (range) {
			commandInput.Range = `bytes=${range.start ?? 0}-${range.end ?? ''}`;
		}

		// 2. A 404 — `NoSuchKey` — is the error every backend shares, so a caller tells a missing object from a denied
		//    or failed read; anything else says nothing about the object and is rethrown
		let stream: GetObjectCommandOutput['Body'];

		try {
			({ Body: stream } = await this.client.send(new GetObjectCommand(commandInput)));
		} catch (error) {
			if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
				throw new StorageFileNotFoundError({ filepath }, { cause: error });
			}

			throw error;
		}

		// 3. The SDK types the body as a union of Node, Web and blob streams; only a Node readable is usable by the
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
	 * @throws StorageFileNotFoundError when S3 answers 404.
	 * @throws The SDK error for any other failure, such as denied credentials or a timeout.
	 */
	async stat(filepath: string): Promise<Stat> {
		let head: HeadObjectCommandOutput;

		// 1. HEAD returns the metadata without transferring the body, which is all this call needs. A HEAD response has
		//    no body, so 404 is the only answer that confirms the object is missing; it becomes the error every backend
		//    shares, anything else says nothing about the object and is rethrown
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

		// 2. Both fields are optional in the SDK's types; a HEAD response without one is a broken answer and is refused
		//    here rather than handed out as `undefined` under the non-optional `Stat` type
		if (head.ContentLength === undefined || head.LastModified === undefined) {
			throw new Error(`No stat returned for file "${filepath}"`);
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
		// 1. Reuse the HEAD request behind `stat`; a successful answer is proof of existence
		try {
			await this.stat(filepath);
			return true;
		} catch (error) {
			// 2. `stat` already reduced a 404 to the kit's "not found"; treating any other failure as missing would make
			//    callers act on a wrong answer
			if (error instanceof StorageFileNotFoundError) return false;

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
		// 1. `CopySource` is a URL-style `/bucket/key` reference, unlike the plain `Key` used for the target, and S3
		//    reads it URL-encoded: a `+` would be taken for a space, a `%` for an escape, a `?` for the version query,
		//    so every segment of the key is encoded — the slashes between them stay
		const params: CopyObjectCommandInput = {
			Key: this.fullPath(dest),
			Bucket: this.config.bucket,
			CopySource: `/${this.config.bucket}/${this.fullPath(src).split('/').map(encodeURIComponent).join('/')}`,
		};

		// 2. S3 does not carry encryption or ACL over from the source object; both have to be restated on the copy
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

		// 1. Set the optional headers only when configured, so the bucket defaults apply otherwise
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
	 * Run any S3 command by its name with the location's client, credentials, bucket and a timeout — the way to what
	 * the storage contract does not cover: versioning, lifecycle rules, bucket policies, CORS, tagging.
	 *
	 * `method` is the name of a command of `@aws-sdk/client-s3`, with or without its `Command` suffix; `params` is the
	 * command's input, in the SDK's field names, and `Bucket` defaults to the location's bucket. Keys in `params` are
	 * sent as given, not placed under the location's root.
	 *
	 * @typeParam T - The command's output; the caller knows it from the SDK's documentation.
	 * @param method - The command: `GetBucketVersioning`, `PutBucketLifecycleConfiguration`, `HeadBucketCommand`.
	 * @param params - The command's input; `Bucket` is the location's unless given.
	 * @param options - A timeout over {@link DEFAULT_S3_CALL_TIMEOUT}, an abort signal, extra headers — signed with
	 * the request. `paramsIn` does not apply: the command places its input itself.
	 * @returns The command's output, without the SDK's `$metadata`.
	 * @throws ProviderCallError when S3 answers with an error status — its status and `{ name, message }` in
	 * `extensions`.
	 * @throws HitRateLimitError when S3 answers 429 or asks to slow down — a 503 `SlowDown`.
	 * @throws TimeoutError when the command outlives its timeout.
	 * @throws Error when the SDK has no command of that name.
	 * @example
	 * ```ts
	 * const { Status } = await s3.call<{ Status?: string }>('GetBucketVersioning');
	 *
	 * await s3.call('PutBucketVersioning', { VersioningConfiguration: { Status: 'Enabled' } });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The command class by its name, looked up among the SDK's exports only: a name that is not a command there is
		//    refused before anything is sent
		const name = method.trim().replace(/Command$/, '');

		const Command = /^[A-Z][A-Za-z0-9]*$/.test(name)
			? (s3 as unknown as Record<string, unknown>)[`${name}Command`]
			: undefined;

		if (typeof Command !== 'function') {
			throw new Error(`The s3 call method "${method}" is not a command of @aws-sdk/client-s3`);
		}

		// 2. The location's bucket unless the caller names another one; a command without a bucket ignores the field
		const input = { Bucket: this.config.bucket, ...params };
		const command = new (Command as S3CommandConstructor)(input);

		// 3. The caller's headers join the request at the build step, before the signing step, so they are signed with
		//    the rest; a header of the same name the SDK set is replaced
		const { headers } = options;

		if (headers && Object.keys(headers).length > 0) {
			command.middlewareStack.add(
				(next) => async (args) => {
					// 1. The request is an HTTP one at this step; anything else is passed on untouched
					const request = args.request as { headers?: Record<string, string> } | undefined;

					if (request?.headers) {
						Object.assign(request.headers, headers);
					}

					return next(args);
				},
				{ step: 'build', name: 'novastarterCallHeaders' },
			);
		}

		// 4. The command under the deadline; the SDK takes the abort signal, so a timed-out request really stops
		let output: Record<string, unknown>;

		try {
			output = (await withTimeout(
				(abortSignal) => this.client.send(command, { abortSignal }),
				options.timeout ?? DEFAULT_S3_CALL_TIMEOUT,
				options.signal ? { signal: options.signal } : {},
			)) as unknown as Record<string, unknown>;
		} catch (error) {
			// 5. An answer of S3 becomes the kit's error with its status. S3 says "slow down" with a 503 `SlowDown`,
			//    other AWS services with throttling codes: each is the kit's 429. The SDK's error is not kept as the
			//    cause — nothing of the request goes into the error; a timeout, an abort or a network failure is passed
			//    on as it is
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

		// 6. The output as the command's documentation describes it; the SDK's request metadata is not part of it
		const rest = { ...output };

		delete rest['$metadata'];

		return rest as T;
	}

	/**
	 * Release the SDK client's connection pool; the process is shutting down.
	 *
	 * @returns Once the client is destroyed.
	 */
	async close(): Promise<void> {
		// 1. The SDK keeps sockets alive between calls, which keeps the process up once nothing else does
		this.client.destroy();
	}

	/**
	 * Enumerate object paths under a prefix, page by page.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Object paths relative to the root. Keys ending in `/` (folder placeholders) are skipped.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. The whole root, or a caller folder, is asked for with its trailing slash, so `media` does not match
		//    `media-archive/…`; no root and no prefix give an empty string, which lists the whole bucket
		const Prefix = toListPrefix(this.fullPath(prefix), prefix);

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
		// 1. Only the extensions the chunked-upload methods back are advertised: `creation` maps to
		//    `createChunkedUpload`, `termination` to `deleteChunkedUpload`, and `expiration` lets the server announce
		//    when an unfinished multipart upload may be discarded. Checksum and concatenation are left out because a
		//    part checksum is verified only when the upload is completed, and parts of several uploads cannot be
		//    joined into one
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
		// 1. A POST without `Upload-Metadata` arrives with no map at all; it is created before the request, so the
		//    upload id always has a place to go and an upload S3 already opened is never lost to a `TypeError`
		const metadata = (context.metadata ??= {});

		// 2. Tag the object with the TUS version and copy the client's content headers into the create request: S3
		//    only accepts them when the multipart upload is created, not when it is completed
		const params: CreateMultipartUploadCommandInput = {
			Bucket: this.config.bucket,
			Key: this.fullPath(filepath),
			Metadata: { 'tus-version': TUS_RESUMABLE },
			...(metadata['contentType'] ? { ContentType: metadata['contentType'] } : {}),
			...(metadata['cacheControl'] ? { CacheControl: metadata['cacheControl'] } : {}),
		};

		// 3. Same encryption rules as a plain write; the KMS key id is only valid for the KMS modes
		if (this.config.serverSideEncryption) {
			params.ServerSideEncryption = this.config.serverSideEncryption;

			if (KMS_KEY_ID_MODES.includes(this.config.serverSideEncryption) && this.config.serverSideEncryptionKmsKeyId) {
				params.SSEKMSKeyId = this.config.serverSideEncryptionKmsKeyId;
			}
		}

		// 4. Open the multipart upload now: S3 assigns the id every later part refers to, so nothing can be sent
		//    before it exists
		const res = await this.client.send(new CreateMultipartUploadCommand(params));

		// 5. Keep the upload id in the context: it is the only handle S3 gives for adding parts, and the context is
		//    what the TUS server hands back on every later call
		metadata['upload-id'] = res.UploadId!;

		return context;
	}

	/**
	 * Abort a resumable upload and remove whatever sits under its key.
	 *
	 * An upload that was completed or aborted before no longer exists for S3, while the object assembled from it does,
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

		let aborted = false;

		// 1. Abort the multipart upload first: S3 keeps (and bills for) uploaded parts until the upload is completed
		//    or aborted. Skipped when no upload id was ever recorded
		if (uploadId) {
			try {
				await this.client.send(
					new AbortMultipartUploadCommand({
						Bucket: this.config.bucket,
						Key: key,
						UploadId: uploadId,
					}),
				);

				aborted = true;
			} catch (error) {
				// 2. The S3 "missing" family of errors means the upload was completed or aborted before, which leaves
				//    only the object to remove; anything else is a real failure. The SDK names the error in `name` —
				//    `NoSuchUpload`, `NoSuchKey`, or `NotFound` for a bodiless 404 — and reports the status in
				//    `$metadata`; it never sets a lowercase `code`
				const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };

				if ($metadata?.httpStatusCode !== 404 && !['NotFound', 'NoSuchKey', 'NoSuchUpload'].includes(name ?? '')) {
					throw error;
				}
			}
		}

		// 3. With no upload to abort, the object under the key is all that can be left; when that is missing too,
		//    the TUS server answers 404. The delete cannot tell, since S3 reports a missing key as deleted
		if (!aborted && !(await this.exists(filepath))) {
			throw ERRORS.FILE_NOT_FOUND;
		}

		// 4. Remove the object under the key as well, so a termination after a completed upload does not leave the
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
	 * @throws Error when the context carries no upload id or no size, meaning the upload was never created by
	 * {@link StorageDriverS3.createChunkedUpload}.
	 * @throws An object with `status_code: 500` when the parts S3 lists still do not add up to the upload size after
	 * three retries, in the shape the TUS server turns into an HTTP response.
	 * @throws The SDK error when the listing or the completion request fails.
	 */
	async finishChunkedUpload(filepath: string, context: ChunkedUploadContext): Promise<void> {
		const key = this.fullPath(filepath);

		// 1. The upload id and the total size are put into the context by `createChunkedUpload`; a context without
		//    them means the calls arrived out of order, and an explicit error says so where a non-null assertion
		//    would surface a `TypeError` naming nothing
		const uploadId = context.metadata?.['upload-id'];

		if (uploadId === undefined || uploadId === null) {
			throw new Error(`Cannot finish the chunked upload of "${filepath}": the context has no upload id`);
		}

		const size = context.size;

		if (size === undefined) {
			throw new Error(`Cannot finish the chunked upload of "${filepath}": the context has no upload size`);
		}

		// 2. The listing may not yet show the last parts; poll with growing pauses (0.5 s, 1 s, 1.5 s) before giving up.
		//    Only a listing that does not add up is retried: a failing `ListParts` call is a real error and goes out at
		//    once
		let parts: Part[];

		try {
			parts = await retry(
				async () => {
					// 1. Parts are checked by their bytes, not their count: a client whose requests do not line up with
					//    the part size leaves parts of uneven sizes, so only the byte total says whether every part is in
					const listed = await this.retrieveParts(key, uploadId);
					const listedBytes = listed.reduce((total, part) => total + (part.Size ?? 0), 0);

					if (listedBytes !== size) {
						throw new PartsMismatchError(listedBytes, size);
					}

					return listed;
				},
				{
					retries: 3,
					delay: (attempt) => 500 * attempt,
					shouldRetry: (error) => error instanceof PartsMismatchError,
				},
			);
		} catch (error) {
			// 3. Completing with a part missing would produce a truncated object, so refuse in the shape the TUS server
			//    turns into an HTTP response and let the client retry
			if (error instanceof PartsMismatchError) {
				throw {
					status_code: 500,
					body: 'Failed to upload all parts to S3.',
				};
			}

			throw error;
		}

		// 4. Every byte is accounted for, so S3 can assemble the object from the parts in the order of the listing
		await this.finishMultipartUpload(key, uploadId, parts);
	}

	/**
	 * Upload one TUS chunk as one or more multipart parts.
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

		// 1. The upload id is put into the context by `createChunkedUpload`; a context without it means the calls
		//    arrived out of order, and an explicit error says so where a non-null assertion would surface a `TypeError`
		//    naming nothing. The size stays `undefined` for a deferred-length upload: parts are then sized for the
		//    largest object S3 allows, and only the chunk that arrives after the client declared the length is
		//    recognised as the final one
		const uploadId = context.metadata?.['upload-id'];

		if (uploadId === undefined || uploadId === null) {
			throw new Error(`Cannot write a chunk of "${filepath}": the context has no upload id`);
		}

		const size = context.size;

		// 2. Part numbers must be unique and increasing within an upload; ask S3 which parts exist instead of keeping
		//    a counter, so a resumed upload continues from the right number
		const parts = await this.retrieveParts(key, uploadId);
		const partNumber: number = parts.length > 0 ? parts[parts.length - 1]!.PartNumber! : 0;
		const nextPartNumber = partNumber + 1;
		const requestedOffset = offset;

		// 3. Report what actually reached S3 rather than the chunk length: a chunk that ended mid-part is not counted,
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

		// 1. The splitter emits an event per part; the handlers below upload each part as soon as it is on disk, while
		//    later parts are still being written
		const splitterStream = new StreamSplitter({
			chunkSize: this.calcOptimalPartSize(size),
			directory: os.tmpdir(),
		})
			.on('beforeChunkStarted', async () => {
				// 1. Take a semaphore permit before a part is buffered, so disk usage stays bounded along with the
				//    number of in-flight uploads
				const granted = await this.partUploadSemaphore.acquire();

				// 2. The pipeline may have failed while the permit was pending: no handler will ever consume this
				//    part, so the permit goes straight back and the splitter is stopped here, before it opens a temp
				//    file nobody would close or remove. The error only reaches a stream that is already destroyed
				if (aborted) {
					await granted.release();

					throw new Error('The upload failed while a part waited for a permit');
				}

				permit = granted;
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

				// 3. The shared slot is cleared the moment the permit is captured: `chunkError` releases whatever sits
				//    in it, and a permit already handed to an in-flight upload would be released a second time from
				//    there, inflating the semaphore past its cap
				permit = undefined;

				offset += partSize;
				bytesReceived += partSize;

				// 4. A part is the final one only when the declared size is reached: while the client defers the length
				//    no part can be recognised as final, so a trailing part under the S3 minimum is skipped like any
				//    other non-final one and the client resends those bytes once the length is known
				const isFinalPart = size !== undefined && size === offset;

				// 5. Upload in the background and collect the promise; awaiting here would serialise the parts
				// eslint-disable-next-line no-async-promise-executor
				const deferred = new Promise<void>(async (resolve, reject) => {
					let readable: fs.ReadStream | undefined;

					try {
						// 1. S3 rejects a part under the minimum size unless it is the last one, so a short trailing
						//    part is skipped and left uncounted: the returned offset then makes the client resend it.
						//    The file is opened only for a part that is sent, since a stream nobody reads would hold
						//    its descriptor until the process exits
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
						// 2. A rejected `UploadPart` leaves the body half-read, so the stream is destroyed to close its
						//    descriptor before the file goes; a failed removal is not worth failing the upload over.
						//    Releasing the permit lets the next part start
						readable?.destroy();
						fsProm.rm(path).catch(() => {});
						acquiredPermit?.release();
					}
				});

				promises.push(deferred);
			})
			.on('chunkError', () => {
				// 1. A splitter failure never reaches `chunkFinished`, so the permit taken for the part being written is
				//    still in the shared slot and is freed here; a permit already captured by `chunkFinished` is no
				//    longer in the slot and is released by that part's own upload, and one still pending is turned back
				//    by `beforeChunkStarted` once it is granted
				aborted = true;
				permit?.release();
			});

		// 2. Drive the incoming stream through the splitter; every part upload is queued by the time this resolves
		try {
			await streamProm.pipeline(readStream, splitterStream);
		} catch (error) {
			// 3. Stop any part still waiting for a permit and clean up the half-written part file, then surface the
			//    pipeline error together with the upload results
			aborted = true;

			if (pendingChunkFilepath !== null) {
				try {
					await fsProm.rm(pendingChunkFilepath);
				} catch (cleanupError) {
					// 4. The pipeline error is the one worth throwing; a temp file left behind is only worth a warning
					useLogger().warn(cleanupError, `Failed to remove chunk "${pendingChunkFilepath}" after an upload error`);
				}
			}

			promises.push(Promise.reject(error));
		} finally {
			// 5. Wait for every queued upload, so the returned byte count reflects what actually reached S3
			await Promise.all(promises);
		}

		// 6. A chunk that finished cleanly with every byte left unsent would come back unchanged, since the offset
		//    does not move; refuse it in the shape the TUS server turns into an HTTP response, naming the size a
		//    request has to reach
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
		// 1. Ask S3 for the page after the marker; S3 is the only record of which parts exist, since the driver keeps
		//    no counter of its own between calls
		const data = await this.client.send(
			new ListPartsCommand({
				Bucket: this.config.bucket,
				Key: key,
				UploadId: uploadId,
				PartNumberMarker: partNumberMarker!,
			}),
		);

		let parts = data.Parts ?? [];

		// 2. S3 pages the listing; recurse with the marker so callers always see the complete set
		if (data.IsTruncated) {
			const rest = await this.retrieveParts(key, uploadId, data.NextPartNumberMarker);
			parts = [...parts, ...rest];
		}

		// 3. Sort once at the outermost call: `CompleteMultipartUpload` requires ascending part numbers, and
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
	 * @param parts - Parts in ascending order, as returned by {@link StorageDriverS3.retrieveParts}.
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
