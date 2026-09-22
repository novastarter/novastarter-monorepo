import { Blob, Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { extname, parse } from 'node:path';
import { Readable } from 'node:stream';
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
import PQueue from 'p-queue';
import type { RequestInit } from 'undici';
import { fetch, FormData } from 'undici';
import { IMAGE_EXTENSIONS, MINIMUM_CHUNK_SIZE, VIDEO_EXTENSIONS } from './constants.js';
import { toFormUrlEncoded } from './to-form-url-encoded.js';
import { toSignatureString } from './to-signature-string.js';

/**
 * Options accepted by {@link StorageDriverCloudinary}.
 */
export type StorageDriverCloudinaryConfig = {
	/** Path prefix every file is placed under; behaves like a root folder inside the Cloudinary account. */
	root?: string | undefined;
	/** Cloudinary cloud name; part of every API and delivery URL. */
	cloudName: string;
	/** API key of the account; sent with every signed request and used for basic auth on the search API. */
	apiKey: string;
	/** API secret; never sent, only used to sign requests and delivery URLs. */
	apiSecret: string;
	/** Access mode stored on uploaded assets: `public` assets are served openly, `authenticated` ones need a signed URL. */
	accessMode: 'public' | 'authenticated';
	/** Resumable-upload tuning. */
	tus?:
		| {
				/** Whether resumable uploads are enabled; only then is `chunkSize` validated. */
				enabled: boolean;
				/** Chunk size in bytes the TUS server sends per request; must be at least {@link MINIMUM_CHUNK_SIZE}. */
				chunkSize?: number | undefined;
		  }
		| undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/storage`, so a location naming `cloudinary` has its
 * options checked against {@link StorageDriverCloudinaryConfig}.
 */
declare module '@novastarter/storage' {
	interface StorageDrivers {
		cloudinary: StorageDriverCloudinaryConfig;
	}
}

/**
 * Storage driver backed by Cloudinary.
 *
 * Cloudinary has no SDK dependency here: every call is a signed request against the upload, admin or delivery API
 * over `undici`. Files are classified by extension into Cloudinary's `image`, `video` and `raw` resource types,
 * because the API routes, the public id rules and the delivery URLs all differ per type. Writes are always chunked
 * (Cloudinary requires chunks of at least 5 MB) and resumable (TUS) uploads map one incoming chunk to one upload
 * request under a shared upload id.
 *
 * @example
 * ```ts
 * import { useStorage } from '@novastarter/storage';
 * import { StorageDriverCloudinary } from '@novastarter/storage-driver-cloudinary';
 * import { env } from './env';
 *
 * const storage = useStorage();
 *
 * storage.registerDriver('cloudinary', StorageDriverCloudinary);
 * storage.registerLocation('media', {
 * 	driver: 'cloudinary',
 * 	options: {
 * 		cloudName: env.STORAGE_CLOUDINARY_CLOUD_NAME,
 * 		apiKey: env.STORAGE_CLOUDINARY_API_KEY,
 * 		apiSecret: env.STORAGE_CLOUDINARY_API_SECRET,
 * 		accessMode: 'public',
 * 	},
 * });
 * ```
 */
export class StorageDriverCloudinary implements TusDriver {
	/**
	 * Normalised root prefix without a leading slash; an empty string when none was configured.
	 *
	 * @internal
	 */
	private root: string;

	/**
	 * API key sent as `api_key` with signed requests and as the basic-auth user on the search API.
	 *
	 * @internal
	 */
	private apiKey: string;

	/**
	 * API secret appended to every signature payload; never leaves the process on its own.
	 *
	 * @internal
	 */
	private apiSecret: string;

	/**
	 * Cloud name that scopes every API and delivery URL.
	 *
	 * @internal
	 */
	private cloudName: string;

	/**
	 * Access mode stored on every uploaded asset.
	 *
	 * @internal
	 */
	private accessMode: 'public' | 'authenticated';

	/**
	 * Largest chunk in bytes `writeChunk` accepts, taken from `tus.chunkSize` when resumable uploads are enabled;
	 * `undefined` when no size was configured, in which case any chunk the TUS server hands is accepted.
	 *
	 * @internal
	 */
	private readonly maximumChunkSize: number | undefined;

	/**
	 * Create a driver from its options.
	 *
	 * @param config - Credentials and behaviour options.
	 * @throws Error when `cloudName`, `apiKey` or `apiSecret` is missing, or when resumable uploads are enabled with a
	 * chunk size below {@link MINIMUM_CHUNK_SIZE}.
	 */
	constructor(config: StorageDriverCloudinaryConfig) {
		// 1. Refuse a missing credential here: every request is signed with it, and Cloudinary would only answer 401
		//    on the first call, without naming the option
		for (const option of ['cloudName', 'apiKey', 'apiSecret'] as const) {
			if (!config[option]) {
				throw new Error(`The cloudinary storage driver needs ${option.startsWith('a') ? 'an' : 'a'} "${option}"`);
			}
		}

		// 2. Normalise the root once without a leading slash: Cloudinary public ids are not paths, and a leading `/`
		//    would become part of the id and produce assets nobody can find by the expected key
		//    `confinePath` also resolves `.` and `..` in the root, the way every key is resolved, so a root of `./media`
		//    strips from listed keys as `media` does, and a root of `/` means the top of the bucket
		this.root = config.root ? confinePath(config.root) : '';
		this.apiKey = config.apiKey;
		this.apiSecret = config.apiSecret;
		this.cloudName = config.cloudName;
		this.accessMode = config.accessMode;

		// 3. Cloudinary rejects chunks smaller than 5 MB, so a TUS chunk size below that would fail on every upload;
		//    refuse it at construction instead
		if (config.tus?.enabled && config.tus.chunkSize && config.tus?.chunkSize < MINIMUM_CHUNK_SIZE) {
			throw new Error('The cloudinary storage driver got a "tus.chunkSize" below 5 MB');
		}

		// 4. The configured size is the ceiling the TUS server agrees to send per request, so it is kept for
		//    `writeChunk` to refuse an oversized chunk before the chunk is sent
		this.maximumChunkSize = config.tus?.enabled ? config.tus.chunkSize : undefined;
	}

	/**
	 * Resolve a caller path to the full path inside the account.
	 *
	 * @param filepath - Path relative to the configured root.
	 * @returns The path with the root prefixed, separators normalised and no leading slash.
	 * @internal
	 */
	private fullPath(filepath: string) {
		// 1. Confine the caller path under the root before joining: a leading `..` is dropped, so `../other/secret`
		//    cannot address a public id outside the location. The result is relative, so an empty root leaves no
		//    leading slash for Cloudinary to take as part of the public id
		return joinPath(this.root, confinePath(filepath));
	}

	/**
	 * Generate the Cloudinary SHA-256 signature for a request payload.
	 *
	 * @param payload - Request parameters, including ones Cloudinary excludes from signing.
	 * @returns Hex digest of the sorted parameter string followed by the API secret.
	 * @see https://cloudinary.com/documentation/signatures
	 * @internal
	 */
	private getFullSignature(payload: Record<string, string>) {
		// 1. Cloudinary documents these four parameters as excluded from the signature; signing them would produce a
		//    digest the API never matches
		const denylist = ['file', 'cloud_name', 'resource_type', 'api_key'];

		const signaturePayload = Object.fromEntries(
			Object.entries(payload).filter(([key]) => denylist.includes(key) === false),
		);

		// 2. The signed string is the sorted `key=value` pairs with raw values, so it matches what Cloudinary rebuilds
		//    from the request on its side
		const signaturePayloadString = toSignatureString(signaturePayload);

		// 3. The secret is appended rather than used as an HMAC key: that is the scheme Cloudinary verifies against
		return createHash('sha256')
			.update(signaturePayloadString + this.apiSecret)
			.digest('hex');
	}

	/**
	 * Create the inline URL signature used by the delivery API.
	 *
	 * @param filepath - Full path of the asset, root included.
	 * @returns The `s--<8 chars>--` segment Cloudinary expects in a signed delivery URL.
	 * @see https://cloudinary.com/documentation/advanced_url_delivery_options#generating_delivery_url_signatures
	 * @internal
	 */
	private getParameterSignature(filepath: string) {
		// 1. Delivery signatures are the first 8 characters of the base64url digest, wrapped in `s--` and `--`, which
		//    is what Cloudinary compares when serving authenticated assets
		return `s--${createHash('sha256')
			.update(filepath + this.apiSecret)
			.digest('base64url')
			.substring(0, 8)}--`;
	}

	/**
	 * Current time as the string Cloudinary expects in the `timestamp` parameter.
	 *
	 * @returns Milliseconds since the epoch, stringified.
	 * @internal
	 */
	private getTimestamp() {
		// 1. Stringified up front because every parameter is signed and sent as text
		return String(new Date().getTime());
	}

	/**
	 * Fresh id that ties the chunks of one upload together on Cloudinary's side.
	 *
	 * @returns A random UUID.
	 * @internal
	 */
	private getUploadId() {
		// 1. A random id rather than the request timestamp: two uploads started in the same millisecond would share
		//    a timestamp, and Cloudinary would then join their chunks into one asset or reject the overlapping ranges
		return randomUUID();
	}

	/**
	 * Guess the Cloudinary resource type for a path from its extension.
	 *
	 * @param filepath - Path or file name.
	 * @returns `image` or `video` for known extensions, `raw` for everything else.
	 * @see https://cloudinary.com/documentation/image_transformations#image_upload_note
	 * @internal
	 */
	private getResourceType(filepath: string) {
		// 1. The extension lists are lower-case, so the comparison must be too; `extname` keeps the dot
		const fileExtension = extname(filepath)?.toLowerCase();
		if (IMAGE_EXTENSIONS.includes(fileExtension)) return 'image';
		if (VIDEO_EXTENSIONS.includes(fileExtension)) return 'video';
		return 'raw';
	}

	/**
	 * Derive the public id from a path.
	 *
	 * For the Cloudinary admin APIs the file extension is omitted for images and videos, because Cloudinary appends
	 * the format itself. Raw assets on the other hand keep the extension as part of the id.
	 *
	 * @param filepath - Path or file name.
	 * @returns The file name with or without its extension, depending on the resource type.
	 * @internal
	 */
	private getPublicId(filepath: string) {
		const { base, name } = parse(filepath);
		const resourceType = this.getResourceType(filepath);

		// 1. Raw ids include the extension: Cloudinary stores no format for them, so the extension is the only way
		//    the name survives
		if (resourceType === 'raw') return base;

		// 2. Image and video ids drop it: Cloudinary derives the format and would otherwise produce `name.png.png`
		return name;
	}

	/**
	 * Folder part of a path, without the file name.
	 *
	 * Cloudinary sometimes treats the folder path leading up to the file id as a separate request entity (the asset
	 * folder), so it is needed on its own.
	 *
	 * @param filepath - Path or file name.
	 * @returns The directory part, empty for a bare file name.
	 * @internal
	 */
	private getFolderPath(filepath: string) {
		// 1. `parse` already yields the directory without a trailing separator, which is the form the API wants
		return parse(filepath).dir;
	}

	/**
	 * Build the `Authorization` header value for Cloudinary's basic-auth endpoints.
	 *
	 * @returns `Basic <base64(apiKey:apiSecret)>`.
	 * @internal
	 */
	private getBasicAuth() {
		// 1. The admin API authenticates with the key/secret pair as basic-auth credentials rather than a signature
		const credentials = `${this.apiKey}:${this.apiSecret}`;
		const base64 = Buffer.from(credentials).toString('base64');
		return `Basic ${base64}`;
	}

	/**
	 * Stream an asset's contents from the delivery API.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @param options - Optional byte range and Cloudinary version number.
	 * @returns The response body as a Node stream.
	 * @throws StorageFileNotFoundError when Cloudinary answers 404.
	 * @throws Error for any other error status or a missing body.
	 */
	async read(filepath: string, options?: ReadOptions): Promise<Readable> {
		const { range, version } = options ?? {};

		// 1. The delivery URL is signed inline, so authenticated assets can be read without a separate token
		const resourceType = this.getResourceType(filepath);
		const fullPath = this.fullPath(filepath);
		const signature = this.getParameterSignature(fullPath);

		let url = `https://res.cloudinary.com/${this.cloudName}/${resourceType}/upload/${signature}`;

		// 2. A version pins the URL to one revision of the asset; without it Cloudinary serves the latest
		if (version) {
			url += `/v${version}`;
		}

		url += `/${fullPath}`;

		const requestInit: RequestInit = { method: 'GET' };

		// 3. Translate the range into the HTTP header form: an omitted start is `0` — `{ end }` alone asks for the
		//    first bytes up to `end`, where `bytes=-N` would mean the last N bytes — and an omitted end is left open
		if (range) {
			requestInit.headers = {
				Range: `bytes=${range.start ?? 0}-${range.end ?? ''}`,
			};
		}

		const response = await fetch(url, requestInit);

		// 4. An error status or a missing body means there is nothing to stream; the body is cancelled first because
		//    an unread body holds its connection open; a 404 becomes the error every backend shares
		if (response.status >= 400 || !response.body) {
			await response.body?.cancel();

			if (response.status === 404) {
				throw new StorageFileNotFoundError({ filepath });
			}

			throw new Error(`No stream returned for file "${filepath}"`);
		}

		// 5. `fetch` returns a Web stream; the rest of the storage layer works with Node readables
		return Readable.fromWeb(response.body);
	}

	/**
	 * Fetch an asset's metadata through the `explicit` upload endpoint.
	 *
	 * `explicit` re-applies upload settings to an existing asset and returns its full record, which makes it the
	 * cheapest signed call that reports size and creation time for a single public id.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @returns The raw response; callers decide how to treat error statuses.
	 * @internal
	 */
	private async requestResource(filepath: string) {
		const fullPath = this.fullPath(filepath);
		const resourceType = this.getResourceType(fullPath);
		const publicId = this.getPublicId(fullPath);
		const folder = this.getFolderPath(fullPath);

		// 1. The public id sent to the API is the folder plus the id, again without a leading slash
		const parameters = {
			public_id: normalizePath(joinPath(folder, publicId), { removeLeading: true }),
			type: 'upload',
			api_key: this.apiKey,
			timestamp: this.getTimestamp(),
		};

		// 2. Sign the parameters first, then send the signature alongside them as a form body
		const signature = this.getFullSignature(parameters);

		const body = toFormUrlEncoded({
			signature,
			...parameters,
		});

		const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/explicit`;

		return await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			},
			body,
		});
	}

	/**
	 * Read an asset's size and creation time.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @returns Size in bytes and the moment Cloudinary created the asset.
	 * @throws StorageFileNotFoundError when Cloudinary answers 404.
	 * @throws Error when the lookup returns any other error status.
	 */
	async stat(filepath: string): Promise<Stat> {
		const response = await this.requestResource(filepath);

		// 1. An error status means no record; cancel the body first because an unread body holds its connection open.
		//    Only a 404 is a definite "missing" and becomes the error every backend shares; other statuses say nothing
		//    about the asset
		if (response.status >= 400) {
			await response.body?.cancel();

			if (response.status === 404) {
				throw new StorageFileNotFoundError({ filepath });
			}

			throw new Error(`No stat returned for file "${filepath}" (${response.status})`);
		}

		// 2. Cloudinary reports no modification time, so `created_at` stands in for it
		const { bytes, created_at } = (await response.json()) as { bytes: number; created_at: string };
		return { size: bytes, modified: new Date(created_at) };
	}

	/**
	 * Check whether an asset is present.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @returns `true` when the lookup succeeded, `false` on a 404.
	 * @throws Error on any other error status, since that says nothing about the asset.
	 */
	async exists(filepath: string): Promise<boolean> {
		const response = await this.requestResource(filepath);

		// 1. Nothing here reads the body, and an unread body holds its connection open
		await response.body?.cancel();

		// 2. Only a 404 is a definite "no"; other failures are surfaced so callers do not act on a wrong answer
		if (response.status === 404) return false;

		if (response.status >= 400) {
			throw new Error(`Couldn't check whether file "${filepath}" exists (${response.status})`);
		}

		return true;
	}

	/**
	 * Move an asset to a new public id.
	 *
	 * @param src - Current asset path.
	 * @param dest - Path to move the asset to.
	 * @throws Error carrying Cloudinary's message when the rename is rejected.
	 */
	async move(src: string, dest: string): Promise<void> {
		// 1. Both sides are resolved to folder plus public id, since that is the form `rename` addresses assets by
		const fullSrc = this.fullPath(src);
		const fullDest = this.fullPath(dest);
		const srcPublicId = this.getPublicId(fullSrc);
		const destPublicId = this.getPublicId(fullDest);
		const srcFolderPath = this.getFolderPath(fullSrc);
		const destFolderPath = this.getFolderPath(fullDest);

		// 2. The resource type comes from the source: a rename cannot change the type of an asset
		const resourceType = this.getResourceType(fullSrc);

		const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/rename`;

		const parameters = {
			from_public_id: joinPath(srcFolderPath, srcPublicId),
			to_public_id: joinPath(destFolderPath, destPublicId),
			api_key: this.apiKey,
			timestamp: this.getTimestamp(),
		};

		const signature = this.getFullSignature(parameters);

		const body = toFormUrlEncoded({
			...parameters,
			signature,
		});

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			},
			body,
		});

		// 3. Cloudinary explains a rejected rename in the JSON body; pass the message on with the path. A body that is
		//    not JSON — a gateway's HTML page among it — reads as `Unknown` instead of crashing the parse
		if (response.status >= 400) {
			const responseData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
			throw new Error(`Can't move file "${src}": ${responseData?.error?.message ?? 'Unknown'}`);
		}

		// 4. An unread body holds its connection open, so the successful rename's body is cancelled rather than left
		//    for the GC to collect
		await response.body?.cancel();
	}

	/**
	 * Copy an asset by streaming it through this process.
	 *
	 * @param src - Asset to copy.
	 * @param dest - Path of the copy.
	 */
	async copy(src: string, dest: string): Promise<void> {
		// 1. Cloudinary offers no server-side copy, so the asset is read back and uploaded under the new path
		const stream = await this.read(src);
		await this.write(dest, stream);
	}

	/**
	 * Upload a stream as an asset, replacing any existing content under the same public id.
	 *
	 * The stream is cut into chunks of about 5.5 MB and each chunk is sent as its own upload request, up to ten in
	 * flight at once. Cloudinary joins the chunks by an upload id unique to this call and the `Content-Range` headers.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @param content - Data to store.
	 * @throws Error wrapping the first failed chunk upload.
	 */
	async write(filepath: string, content: Readable): Promise<void> {
		const fullPath = this.fullPath(filepath);
		const resourceType = this.getResourceType(fullPath);
		const folderPath = this.getFolderPath(fullPath);

		// 1. The same parameters, signature and upload id go with every chunk; a folder becomes the asset folder and
		//    is also used as the public id prefix, so the id ends up as `folder/name` on Cloudinary's side
		const uploadId = this.getUploadId();

		const uploadParameters = {
			timestamp: this.getTimestamp(),
			api_key: this.apiKey,
			type: 'upload',
			access_mode: this.accessMode,
			public_id: this.getPublicId(fullPath),
			...(folderPath
				? {
						asset_folder: folderPath,
						use_asset_folder_as_public_id_prefix: 'true',
					}
				: {}),
		};

		const signature = this.getFullSignature(uploadParameters);

		let totalSize = 0;
		let uploaded = 0;
		let error: Error | null = null;

		// 2. Chunks upload concurrently while the stream keeps buffering; the first failure is remembered rather than
		//    thrown, so the loop can drain the stream and the queue can settle before reporting it
		const queue = new PQueue({ concurrency: 10 });

		// 3. Cloudinary requires each chunk to be at least 5 MB; 5.5 MB leaves a safety margin above that
		const chunkSize = 5.5e6;
		let chunks = Buffer.alloc(0);

		for await (let chunk of content) {
			if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);

			// 4. Append first and cut afterwards: a source chunk can be larger than an upload chunk — an object-mode
			//    stream or a large high-water mark yields such chunks — so one append may complete several upload
			//    chunks, and computing the "space left" in the buffer instead would go negative and drop bytes
			chunks = Buffer.concat([chunks, chunk], chunks.length + chunk.length);
			totalSize += chunk.length;

			// 5. Queue every full chunk and keep only the remainder; a buffer of exactly the chunk size stays, since
			//    the last request must carry the total, which is unknown while the stream is still flowing — `-1`
			//    tells Cloudinary more is coming. `Blob` copies the bytes, so the view can be dropped right away
			while (chunks.length > chunkSize) {
				const blob = new Blob([chunks.subarray(0, chunkSize)]);
				const bytesOffset = uploaded;

				chunks = chunks.subarray(chunkSize);
				uploaded += chunkSize;

				queue
					.add(() =>
						this.uploadChunk({
							resourceType,
							blob,
							bytesOffset,
							bytesTotal: -1,
							uploadId,
							parameters: {
								signature,
								...uploadParameters,
							},
						}),
					)
					.catch((err) => {
						error = err;
					});
			}
		}

		// 6. The last chunk carries the real total, which is how Cloudinary knows the upload is complete
		queue
			.add(() =>
				this.uploadChunk({
					resourceType,
					blob: new Blob([chunks]),
					bytesOffset: uploaded,
					bytesTotal: totalSize,
					uploadId,
					parameters: {
						signature,
						...uploadParameters,
					},
				}),
			)
			.catch((err) => {
				error = err;
			});

		await queue.onIdle();

		// 7. Surface the first chunk failure with the path once every request has settled
		if (error) {
			throw new Error(`Can't upload file "${filepath}": ${(error as Error).message}`, { cause: error });
		}
	}

	/**
	 * Send one chunk of an upload to the upload API.
	 *
	 * @param options - Chunk and request details.
	 * @param options.resourceType - Cloudinary resource type that selects the upload endpoint.
	 * @param options.blob - Chunk contents.
	 * @param options.bytesOffset - Byte offset of the chunk within the whole upload.
	 * @param options.bytesTotal - Total upload size, or `-1` while it is still unknown.
	 * @param options.uploadId - Id shared by every chunk of one upload; Cloudinary joins the chunks by it.
	 * @param options.parameters - Signed form parameters, sent as text fields next to the file.
	 * @throws Error carrying Cloudinary's message when the chunk is rejected.
	 * @see https://support.cloudinary.com/hc/en-us/articles/208263735-Guidelines-for-self-implementing-chunked-upload-to-Cloudinary
	 * @internal
	 */
	private async uploadChunk({
		resourceType,
		blob,
		bytesOffset,
		bytesTotal,
		uploadId,
		parameters,
	}: {
		resourceType: string;
		blob: Blob;
		bytesOffset: number;
		bytesTotal: number;
		uploadId: string;
		parameters: Record<string, string>;
	}) {
		// 1. Chunks go as multipart form data: the file part plus every signed parameter as a text field
		const formData = new FormData();

		formData.set('file', blob);

		for (const [key, value] of Object.entries(parameters)) {
			formData.set(key, value);
		}

		// 2. `X-Unique-Upload-Id` ties the chunks of one upload together and `Content-Range` places each chunk; the
		//    id travels as a header, outside the signed parameters, so it is free to differ from the timestamp
		const response = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`, {
			method: 'POST',
			body: formData,
			headers: {
				'X-Unique-Upload-Id': uploadId,
				'Content-Range': `bytes ${bytesOffset}-${bytesOffset + blob.size - 1}/${bytesTotal}`,
			},
		});

		// 3. Cloudinary explains a rejected chunk in the JSON body; pass the message on. A body that is not JSON reads
		//    as `Unknown` instead of crashing the parse
		if (response.status >= 400) {
			const responseData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
			throw new Error(responseData?.error?.message ?? 'Unknown');
		}

		// 4. An unread body holds its connection open, so the successful chunk's body is cancelled rather than left for
		//    the GC to collect
		await response.body?.cancel();
	}

	/**
	 * Remove an asset.
	 *
	 * @param filepath - Asset path relative to the root.
	 * @throws Error carrying Cloudinary's message when the request fails.
	 */
	async delete(filepath: string): Promise<void> {
		const fullPath = this.fullPath(filepath);
		const resourceType = this.getResourceType(fullPath);
		const publicId = this.getPublicId(fullPath);
		const folderPath = this.getFolderPath(fullPath);
		const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/destroy`;

		// 1. `resource_type` is sent as a parameter as well as in the URL; it is on the signing denylist, so the
		//    signature stays valid either way
		const parameters = {
			timestamp: this.getTimestamp(),
			api_key: this.apiKey,
			resource_type: resourceType,
			public_id: normalizePath(joinPath(folderPath, publicId), { removeLeading: true }),
		};

		const signature = this.getFullSignature(parameters);

		// 2. A missing asset is reported by Cloudinary as `200` with `result: 'not found'`, so it reads as already deleted,
		//    as it does on the other drivers; an error status — a rotated secret, a rate limit, a 5xx — is a delete that did
		//    not happen and is thrown, the way every other driver rejects a failed delete
		const response = await fetch(url, {
			method: 'POST',
			body: toFormUrlEncoded({
				...parameters,
				signature,
			}),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			},
		});

		if (response.status >= 400) {
			const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
			throw new Error(`Error deleting file "${filepath}": ${json.error?.message ?? `HTTP ${response.status}`}`);
		}

		// 3. An unread body holds its connection open, so the successful destroy's body is cancelled rather than left
		//    for the GC to collect
		await response.body?.cancel();
	}

	/**
	 * Enumerate asset paths under a prefix through the search API.
	 *
	 * @param prefix - Path prefix relative to the root; the whole root when empty.
	 * @returns Asset paths relative to the root, with the format re-attached for images and videos.
	 * @throws Error carrying Cloudinary's message when the search fails.
	 */
	async *list(prefix = ''): AsyncGenerator<string, void, unknown> {
		// 1. The whole root, or a caller folder, is searched with its trailing slash, so `media` does not match
		//    `media-archive/…`
		const fullPath = toListPrefix(this.fullPath(prefix), prefix);

		let nextCursor = '';

		// 2. The search API pages with a cursor; an empty cursor on the first call asks for the first page. The query
		//    goes through `URLSearchParams` so a prefix carrying `&`, `#` or `+` cannot break out of the `expression`
		//    value
		do {
			const query = new URLSearchParams({ expression: `${fullPath}*`, next_cursor: nextCursor });

			const response = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/resources/search?${query}`, {
				method: 'GET',
				headers: {
					Authorization: this.getBasicAuth(),
				},
			});

			const json = (await response.json().catch(() => ({}))) as {
				next_cursor: string;
				resources: {
					public_id: string;
					format: string;
					resource_type: string;
					filename: string;
				}[];
			};

			// 3. Cloudinary explains a failed search in the JSON body already read above — a body can be read once;
			//    pass the message on with the prefix
			if (response.status >= 400) {
				const responseData = json as unknown as { error?: { message?: string } };
				throw new Error(`Can't list for prefix "${prefix}": ${responseData?.error?.message ?? 'Unknown'}`);
			}

			nextCursor = json.next_cursor;

			for (const file of json.resources) {
				// 4. Strip the root and its slash so callers get paths in the form they pass in; images and videos get
				//    their extension back because their public id was stored without it
				const filename = toRelativePath(this.root, file.public_id);
				if (file.resource_type === 'image' || file.resource_type === 'video') yield `${filename}.${file.format}`;
				else yield filename;
			}
		} while (nextCursor);
	}

	/**
	 * TUS extensions this driver advertises: creation, termination and expiration.
	 *
	 * @returns The extension names in the order the TUS server advertises them.
	 */
	get tusExtensions(): string[] {
		// 1. Only the extensions the chunked-upload methods back are advertised: `creation` maps to
		//    `createChunkedUpload`, `termination` to `deleteChunkedUpload`, and `expiration` lets the server announce
		//    when an unfinished upload may be discarded, which Cloudinary does with incomplete chunked uploads on its
		//    own. Checksum and concatenation are left out because a chunk is only verifiable once Cloudinary has
		//    assembled the asset, and chunks of several uploads cannot be joined into one
		return ['creation', 'termination', 'expiration'];
	}

	/**
	 * Start a resumable upload.
	 *
	 * @param _filepath - Final asset path relative to the root; unused.
	 * @param context - Client-supplied size and metadata; the metadata map is created when the client sent none.
	 * @returns The context with the signing timestamp and the upload id recorded in its metadata.
	 */
	async createChunkedUpload(_filepath: string, context: ChunkedUploadContext): Promise<ChunkedUploadContext> {
		// 1. A POST without `Upload-Metadata` arrives with no map at all; it is created here, before anything is
		//    recorded, so storing the upload state below cannot fail with a TypeError
		const metadata = (context.metadata ??= {});

		// 2. Every chunk of one upload must carry the same timestamp, since it is part of the signature, and the same
		//    upload id, since Cloudinary joins the chunks by it; the context is what the TUS server hands back on
		//    every following call, so both are recorded there
		metadata['timestamp'] = this.getTimestamp();
		metadata['uploadId'] = this.getUploadId();

		return context;
	}

	/**
	 * Forward one TUS chunk to the upload API.
	 *
	 * @param filepath - Final asset path relative to the root.
	 * @param content - Chunk data as sent by the client.
	 * @param offset - Byte offset within the whole upload where this chunk starts.
	 * @param context - Context carrying the total `size` and the `timestamp` and `uploadId` recorded by
	 * {@link StorageDriverCloudinary.createChunkedUpload}.
	 * @returns The new upload offset: `offset` plus the bytes of this chunk.
	 * @throws Error when the chunk exceeds the size configured as `tus.chunkSize`.
	 * @throws Error carrying Cloudinary's message when the chunk is rejected.
	 */
	async writeChunk(
		filepath: string,
		content: Readable,
		offset: number,
		context: ChunkedUploadContext,
	): Promise<number> {
		const fullPath = this.fullPath(filepath);
		const folderPath = this.getFolderPath(fullPath);
		const resourceType = this.getResourceType(filepath);

		// 1. The map is read for the upload state below and may arrive absent from a POST without `Upload-Metadata`; it
		//    is created rather than crashing with a TypeError, so the failure a missing session causes is the API's, not
		//    the driver's
		const metadata = (context.metadata ??= {});

		// 2. Same parameters as a plain write, except the timestamp comes from the context so every chunk carries
		//    the signature the upload started with
		const uploadParameters = {
			timestamp: metadata['timestamp'] as string,
			api_key: this.apiKey,
			type: 'upload',
			access_mode: this.accessMode,
			public_id: this.getPublicId(fullPath),
			...(folderPath
				? {
						asset_folder: folderPath,
						use_asset_folder_as_public_id_prefix: 'true',
					}
				: {}),
		};

		// 3. The upload id also comes from the context, so every chunk lands in the same Cloudinary upload; an upload
		//    started before the id was recorded keeps the timestamp its earlier chunks went out under
		const uploadId = metadata['uploadId'] ?? uploadParameters.timestamp;

		let bytesUploaded = offset || 0;
		let currentChunkSize = 0;
		let chunks = Buffer.alloc(0);

		// 4. Buffer the whole chunk: the upload API needs its size for `Content-Range` before the request starts
		for await (const chunk of content) {
			currentChunkSize += chunk.length;
			chunks = Buffer.concat([chunks, chunk], currentChunkSize);
		}

		bytesUploaded += currentChunkSize;

		// 5. The TUS server agreed to send at most the configured size per request; an oversized chunk is refused
		//    before it is sent, since Cloudinary would assemble an asset from bytes the upload never agreed to carry
		if (this.maximumChunkSize !== undefined && currentChunkSize > this.maximumChunkSize) {
			throw new Error(
				`The chunk of ${currentChunkSize} bytes exceeds the chunk size limit of ${this.maximumChunkSize} bytes`,
			);
		}

		// 6. Only the chunk that reaches the declared size carries the real total; earlier ones send `-1`, which
		//    tells Cloudinary more is coming
		await this.uploadChunk({
			resourceType,
			blob: new Blob([chunks]),
			bytesOffset: offset || 0,
			bytesTotal: context.size && bytesUploaded === context.size ? context.size : -1,
			uploadId,
			parameters: {
				signature: this.getFullSignature(uploadParameters),
				...uploadParameters,
			},
		});

		return bytesUploaded;
	}

	/**
	 * Complete a resumable upload.
	 *
	 * Cloudinary assembles the asset itself once the chunk carrying the total size arrives, so there is nothing to do.
	 *
	 * @param _filepath - Final asset path relative to the root; unused.
	 * @param _context - Upload context; unused.
	 */
	async finishChunkedUpload(_filepath: string, _context: ChunkedUploadContext): Promise<void> {}

	/**
	 * Abort a resumable upload by removing whatever sits under its public id.
	 *
	 * @param filepath - Final asset path relative to the root.
	 * @param _context - Upload context; unused, since Cloudinary discards incomplete chunked uploads on its own.
	 */
	async deleteChunkedUpload(filepath: string, _context: ChunkedUploadContext): Promise<void> {
		// 1. Only the asset under the final id is removed; partial chunks have no handle the driver could abort
		await this.delete(filepath);
	}
}
