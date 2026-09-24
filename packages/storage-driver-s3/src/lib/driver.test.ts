/**
 * Tests of `storage-driver-s3/lib/driver`.
 */
import fs, { promises as fsPromises } from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import type { HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetBucketVersioningCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	PutBucketVersioningCommand,
	PutObjectCommand,
	S3Client,
	S3ServiceException,
	ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
	rand,
	randAlphaNumeric,
	randBoolean,
	randGitBranch as randBucket,
	randDirectoryPath,
	randDomainName,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randText,
	randGitShortSha as randUnique,
	randWord,
} from '@ngneat/falso';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, retry, withTimeout } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { Semaphore } from '@shopify/semaphore';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ERRORS } from '@tus/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverS3Config } from './driver.js';
import { StorageDriverS3 } from './driver.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/utils/node');
vi.mock('@novastarter/utils');
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/lib-storage');

const { retry: retryActual, withTimeout: withTimeoutActual } =
	await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 *
 * The `path.*Full` values are what the stubbed `fullPath` returns for the matching `path.*` input.
 */
let sample: {
	config: StorageDriverS3Config &
		Required<Pick<StorageDriverS3Config, 'key' | 'secret' | 'root' | 'region' | 'forcePathStyle'>>;
	path: {
		input: string;
		inputFull: string;
		src: string;
		srcFull: string;
		dest: string;
		destFull: string;
	};
	range: {
		start: number;
		end: number;
	};
	stream: PassThrough;
	text: string;
	file: {
		type: string;
		size: number;
		modified: Date;
	};
};

/**
 * Driver under test, created with the minimal config so each `describe` block can opt into extra options.
 */
let driver: StorageDriverS3;

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			key: randAlphaNumeric({ length: 20 }).join(''),
			secret: randAlphaNumeric({ length: 40 }).join(''),
			bucket: randBucket(),
			acl: 'private',
			serverSideEncryption: rand(Object.values(ServerSideEncryption)),
			serverSideEncryptionKmsKeyId: randAlphaNumeric({ length: 20 }).join(''),
			root: randDirectoryPath(),
			endpoint: randDomainName(),
			region: randWord(),
			forcePathStyle: randBoolean(),
		},
		path: {
			input: randUnique() + randFilePath(),
			inputFull: randUnique() + randFilePath(),
			src: randUnique() + randFilePath(),
			srcFull: randUnique() + randFilePath(),
			dest: randUnique() + randFilePath(),
			destFull: randUnique() + randFilePath(),
		},
		range: {
			start: randNumber(),
			end: randNumber(),
		},
		stream: new PassThrough(),
		text: randText(),
		file: {
			type: randFileType(),
			size: randNumber(),
			modified: randPastDate(),
		},
	};

	// 2. Every SDK module is mocked above, so constructing the driver only records calls and never opens a socket
	driver = new StorageDriverS3({
		key: sample.config.key,
		secret: sample.config.secret,
		bucket: sample.config.bucket,
	});

	// 3. Stub the private path resolver with a lookup table, so assertions can match exact keys without depending on
	//    the mocked `joinPath`
	driver['fullPath'] = vi.fn().mockImplementation((input) => {
		if (input === sample.path.src) return sample.path.srcFull;
		if (input === sample.path.dest) return sample.path.destFull;
		if (input === sample.path.input) return sample.path.inputFull;

		return '';
	});
});

afterEach(() => {
	// 1. Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	let getClientBackup: (typeof StorageDriverS3.prototype)['getClient'];
	let sampleClient: S3Client;

	beforeEach(() => {
		// 1. Swap `getClient` on the prototype before construction, so the constructor's own call is observable; the
		//    original is restored afterwards because the other describe blocks rely on it
		getClientBackup = StorageDriverS3.prototype['getClient'];
		sampleClient = {} as S3Client;
		StorageDriverS3.prototype['getClient'] = vi.fn().mockReturnValue(sampleClient);
	});

	afterEach(() => {
		StorageDriverS3.prototype['getClient'] = getClientBackup;
	});

	test('Saves passed config to local property', () => {
		// 1. The config must be kept by reference: the other describe blocks tweak it on the instance after construction
		const driver = new StorageDriverS3(sample.config);
		expect(driver['config']).toBe(sample.config);
	});

	test('Creates shared client', () => {
		// 1. The client is built inside the constructor, so a bad config fails early; the stub only records that call
		const driver = new StorageDriverS3(sample.config);
		expect(driver['getClient']).toHaveBeenCalledOnce();
		expect(driver['client']).toBe(sampleClient);
	});

	test('Defaults root to empty string', () => {
		// 1. No root given: keys are placed at the top of the bucket, so the prefix must be empty rather than `/`
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		// 1. `confinePath` is auto-mocked; a fixed return value shows the driver stores the confined result, not the raw root
		const mockRoot = randDirectoryPath();

		vi.mocked(confinePath).mockReturnValue(mockRoot);

		const driver = new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			root: sample.config.root,
		});

		// 2. The root is confined like every key: no leading slash, `.` and `..` resolved
		expect(confinePath).toHaveBeenCalledWith(sample.config.root);
		expect(driver['root']).toBe(mockRoot);
	});

	test.each([[1024], [5_242_879], [Number.NaN]])('Refuses a tus.chunkSize of %s, below the S3 minimum', (chunkSize) => {
		// 1. Every part but the last has to reach the S3 minimum, so a smaller preferred size could never advance an
		//    upload; it is refused at construction with the minimum named rather than on the first PATCH
		expect(
			() =>
				new StorageDriverS3({
					key: sample.config.key,
					secret: sample.config.secret,
					bucket: sample.config.bucket,
					tus: { chunkSize },
				}),
		).toThrowError('The s3 storage driver needs a "tus.chunkSize" of at least 5242880 bytes');
	});

	test('Takes a tus.chunkSize at the S3 minimum or above as the preferred part size', () => {
		// 1. The minimum itself is allowed: it is the smallest part S3 accepts, and the default when nothing is given
		const chunkSize = rand([5_242_880, 16 * 1024 * 1024]);

		const driver = new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			tus: { chunkSize },
		});

		expect(driver['preferredPartSize']).toBe(chunkSize);
	});
});

describe('#getClient', () => {
	test('Throws error if bucket missing', () => {
		// 1. The constructor calls `getClient` itself, so every case here is driven through `new` rather than a direct
		//    call. Every command targets the bucket, so its absence is refused at construction rather than on the first
		//    request
		expect(() => new StorageDriverS3({ bucket: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The s3 storage driver needs a "bucket"]`,
		);
	});

	test('Throws error if key defined but secret missing', () => {
		// 1. The constructor builds the client, so half a credential pair must throw before any client exists
		expect(() => new StorageDriverS3({ key: 'key', bucket: 'bucket' })).toThrowError(
			'The s3 storage driver needs "key" and "secret" together',
		);
	});

	test('Throws error if secret defined but key missing', () => {
		// 1. The constructor builds the client, so half a credential pair must throw before any client exists
		expect(() => new StorageDriverS3({ secret: 'secret', bucket: 'bucket' })).toThrowError(
			'The s3 storage driver needs "key" and "secret" together',
		);
	});

	test('Creates S3Client without key / secret (based on machine config)', () => {
		// 1. Without a key pair no `credentials` entry may appear, so the SDK falls back to its own provider chain
		const driver = new StorageDriverS3({ bucket: 'bucket' });

		expect(S3Client).toHaveBeenCalledWith({
			requestHandler: expect.any(NodeHttpHandler),
		});

		expect(driver['client']).toBeInstanceOf(S3Client);
	});

	test('Creates S3Client with key / secret configuration', () => {
		// 1. The shared driver from `beforeEach` was built with both halves, so its constructor call is already recorded
		expect(S3Client).toHaveBeenCalledWith({
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});

		expect(driver['client']).toBeInstanceOf(S3Client);
	});

	test('Sets http endpoints', () => {
		// 1. A plain-http endpoint must keep its scheme; only local setups use it, so it is never assumed
		const sampleDomain = randDomainName();
		const sampleHttpEndpoint = `http://${sampleDomain}`;

		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			endpoint: sampleHttpEndpoint,
		});

		// 2. The SDK takes the endpoint as a hostname/protocol/path triple, so the driver must split the URL itself
		expect(S3Client).toHaveBeenCalledWith({
			endpoint: {
				hostname: sampleDomain,
				protocol: 'http:',
				path: '/',
			},
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});

	test('Sets https endpoints', () => {
		// 1. https is the assumed scheme; the prefix is stripped from the hostname either way
		const sampleDomain = randDomainName();
		const sampleHttpEndpoint = `https://${sampleDomain}`;

		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			endpoint: sampleHttpEndpoint,
		});

		// 2. Same triple as for http, with the scheme carried in `protocol` rather than in the hostname
		expect(S3Client).toHaveBeenCalledWith({
			endpoint: {
				hostname: sampleDomain,
				protocol: 'https:',
				path: '/',
			},
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});

	test('Keeps a path prefix and a port of a custom endpoint', () => {
		// 1. An S3-compatible service mounted under a path prefix loses it when the endpoint is split by string
		//    replacement, and a port ends up inside `hostname`; the URL parser forwards both to their own fields
		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			endpoint: 'http://localhost:9000/s3',
		});

		expect(S3Client).toHaveBeenCalledWith({
			endpoint: {
				hostname: 'localhost',
				protocol: 'http:',
				path: '/s3',
				port: 9000,
			},
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});

	test('Sets region', () => {
		// 1. Region is optional; when given it must reach the SDK unchanged, next to the credentials
		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			region: sample.config.region,
		});

		expect(S3Client).toHaveBeenCalledWith({
			region: sample.config.region,
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});

	test('Sets force path style', () => {
		// 1. `false` is a meaningful value here, so the flag must be forwarded whenever it is defined; the random
		//    boolean covers both cases over time
		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			forcePathStyle: sample.config.forcePathStyle,
		});

		expect(S3Client).toHaveBeenCalledWith({
			forcePathStyle: sample.config.forcePathStyle,
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});

	test('Sets checksum policies', () => {
		// 1. Both policies must reach the SDK unchanged; `WHEN_REQUIRED` is what S3-compatible services without
		//    flexible checksums (Cloudflare R2) need to accept PutObject / UploadPart
		new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});

		expect(S3Client).toHaveBeenCalledWith({
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
			credentials: {
				accessKeyId: sample.config.key,
				secretAccessKey: sample.config.secret,
			},
			requestHandler: expect.any(NodeHttpHandler),
		});
	});
});

describe('#fullPath', () => {
	test('Returns normalized joined path', () => {
		// 1. Use a fresh driver: the shared one has `fullPath` stubbed out in the top-level `beforeEach`
		const driver = new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
		});

		// 2. `joinPath` is auto-mocked; a fixed return value lets the assertions check the wiring, not real path logic
		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(confinePath).mockReturnValue(sample.path.input);

		// 3. Point the driver at a root, since the shared config leaves it empty
		// @ts-expect-error - mutating private attribute
		driver['root'] = sample.config.root;

		// 4. `joinPath` must get root and path in that order, and its result is the key
		const result = driver['fullPath'](sample.path.input);

		// 5. The caller path is confined first, so a leading `..` is dropped before the root is joined
		expect(confinePath).toHaveBeenCalledWith(sample.path.input);
		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#read', () => {
	beforeEach(() => {
		// 1. `isReadableStream` is auto-mocked and would return `undefined`, so it is forced to accept the bare `Readable`
		vi.mocked(driver['client'].send).mockReturnValue({
			Body: new Readable(),
		} as unknown as void);

		vi.mocked(isReadableStream).mockReturnValue(true);
	});

	test('Throws StorageFileNotFoundError when S3 answers 404, rethrows anything else', async () => {
		// 1. `NoSuchKey` is the error every backend shares; a denied read says nothing about the object
		vi.mocked(driver['client'].send).mockRejectedValueOnce(
			Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } }) as never,
		);

		await expect(driver.read(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);

		const denied = Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } });
		vi.mocked(driver['client'].send).mockRejectedValueOnce(denied as never);

		await expect(driver.read(sample.path.input)).rejects.toBe(denied);
	});

	test('Uses fullPath key / bucket in command input', async () => {
		// 1. No options: the command must carry only Key and Bucket, with no Range header
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);

		expect(GetObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
		});
	});

	test('Optionally allows setting start range offset', async () => {
		// 1. An open end must serialise as `bytes=start-`, so S3 reads up to the last byte
		await driver.read(sample.path.input, {
			range: { start: sample.range.start },
		});

		expect(GetObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
			Range: `bytes=${sample.range.start}-`,
		});
	});

	test('Optionally allows setting end range offset', async () => {
		// 1. Only `end` set: the header becomes `bytes=0-end`, the first bytes up to `end`; `bytes=-end` would be a
		//    suffix range, the last N bytes, which is not what an `end` offset means
		await driver.read(sample.path.input, { range: { end: sample.range.end } });

		expect(GetObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
			Range: `bytes=0-${sample.range.end}`,
		});
	});

	test('Optionally allows setting start and end range offset', async () => {
		// 1. Both bounds present: an inclusive `bytes=start-end` header
		await driver.read(sample.path.input, { range: sample.range });

		expect(GetObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
			Range: `bytes=${sample.range.start}-${sample.range.end}`,
		});
	});

	test('Throws an error when no stream is returned', async () => {
		// 1. A response without a body must surface as a failed read, not as an `undefined` return
		vi.mocked(driver['client'].send).mockReturnValue({
			Body: undefined,
		} as unknown as void);

		await expect(driver.read(sample.path.input, { range: sample.range })).rejects.toThrowError(
			`No stream returned for file "${sample.path.input}"`,
		);
	});

	test('Throws an error when returned stream is not a readable stream', async () => {
		// 1. A body that is not a Node readable (for example a Web stream) is rejected the same way
		vi.mocked(isReadableStream).mockReturnValue(false);

		await expect(driver.read(sample.path.input, { range: sample.range })).rejects.toThrowError(
			new Error(`No stream returned for file "${sample.path.input}"`),
		);
	});

	test('Returns stream from S3 client', async () => {
		// 1. Stub the command constructor too, so the exact instance handed to `send` can be asserted
		const mockGetObjectCommand = {} as GetObjectCommand;

		vi.mocked(driver['client'].send).mockReturnValue({
			Body: sample.stream,
		} as unknown as void);

		vi.mocked(GetObjectCommand).mockReturnValue(mockGetObjectCommand);

		// 2. The body must come back untouched, without any wrapping
		const stream = await driver.read(sample.path.input, {
			range: sample.range,
		});

		expect(driver['client'].send).toHaveBeenCalledWith(mockGetObjectCommand);
		expect(stream).toBe(sample.stream);
	});
});

describe('#stat', () => {
	beforeEach(() => {
		// 1. A HEAD response carries these two fields; the driver must map them onto `size` and `modified`
		vi.mocked(driver['client'].send).mockResolvedValue({
			ContentLength: sample.file.size,
			LastModified: sample.file.modified,
		} as HeadObjectCommandOutput as unknown as void);
	});

	test('Uses HeadObjectCommand with fullPath', async () => {
		// 1. HEAD instead of GET keeps the body off the wire; the key must still go through `fullPath`
		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);

		expect(HeadObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
		});
	});

	test('Calls #send with HeadObjectCommand', async () => {
		// 1. Stub the command constructor, so the exact instance handed to `send` can be asserted
		const mockHeadObjectCommand = {} as HeadObjectCommand;
		vi.mocked(HeadObjectCommand).mockReturnValue(mockHeadObjectCommand);

		await driver.stat(sample.path.input);

		expect(driver['client'].send).toHaveBeenCalledWith(mockHeadObjectCommand);
	});

	test('Returns size/modified from returned send data', async () => {
		// 1. The SDK field names differ from the storage contract, so the driver has to rename them
		const result = await driver.stat(sample.path.input);

		expect(result).toStrictEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});
	});

	test('Maps a 404 to the kit error', async () => {
		// 1. Only a 404 in `$metadata` means "missing"; the driver turns it into the error every backend shares and
		//    keeps the SDK error as cause
		const cause = Object.assign(new Error(), { $metadata: { httpStatusCode: 404 } });
		vi.mocked(driver['client'].send).mockRejectedValue(cause as unknown as void);

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other SDK error', async () => {
		// 1. A 403 covers rejected credentials as much as a missing object, so it must not be reported as "not found"
		const error = Object.assign(new Error(), { $metadata: { httpStatusCode: 403 } });
		vi.mocked(driver['client'].send).mockRejectedValue(error as unknown as void);

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});

	test('Refuses a HEAD response missing size or modification time', async () => {
		// 1. Both fields are optional in the SDK's types; answering `undefined` under the non-optional `Stat` type
		//    would fail far from its cause, so a broken response is refused with the path named
		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}"`,
		);
	});
});

describe('#exists', () => {
	beforeEach(() => {
		// 1. `exists` is a thin wrapper over `stat`; stubbing `stat` keeps these tests about the error mapping alone
		driver.stat = vi.fn();
	});

	test('Returns true if stat returns the stats', async () => {
		// 1. Any successful HEAD proves existence; the returned values themselves do not matter here
		vi.mocked(driver.stat).mockResolvedValue({
			size: sample.file.size,
			modified: sample.file.modified,
		});

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(true);
	});

	test('Returns false if the object is not found', async () => {
		// 1. `stat` reduces a 404 to the kit's "not found", which is the one error `exists` may read as `false`
		vi.mocked(driver.stat).mockRejectedValue(new StorageFileNotFoundError({ filepath: sample.path.input }));

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(false);
	});

	/**
	 * Reporting a timed out or rejected request as "the file isn't there" makes callers act on a wrong
	 * answer, for example by serving a permission error for a file that does exist. A 403 is not an
	 * answer either: HEAD has no body, so it covers rejected credentials as much as a missing object.
	 *
	 * Error shapes as produced by @aws-sdk/client-s3 3.928.0. A timeout carries `$metadata` without a
	 * `httpStatusCode`.
	 */
	test.each([
		['a rejected request', { $metadata: { httpStatusCode: 403 } }],
		['the wrong region', { $metadata: { httpStatusCode: 301 } }],
		['a server error', { $metadata: { httpStatusCode: 500 } }],
		['a socket timeout', { name: 'TimeoutError', $metadata: { attempts: 3 } }],
		['a refused connection', { code: 'ECONNREFUSED' }],
	])('Throws if the lookup failed with %s', async (_, shape) => {
		// 1. Every non-404 failure must propagate unchanged, so callers can tell an outage from a missing file
		const error = Object.assign(new Error(), shape);

		vi.mocked(driver.stat).mockRejectedValue(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrow(error);
	});
});

describe('#move', () => {
	beforeEach(async () => {
		// 1. Stub both halves and run the move once; the tests below only assert the delegation
		driver.copy = vi.fn();
		driver.delete = vi.fn();

		await driver.move(sample.path.src, sample.path.dest);
	});

	test('Calls copy with given src and dest', async () => {
		// 1. The copy is the half that carries the data, so it must get both paths untouched
		expect(driver.copy).toHaveBeenCalledWith(sample.path.src, sample.path.dest);
	});

	test('Calls delete on successful copy', async () => {
		// 1. Only the source goes: deleting the destination would undo the copy
		expect(driver.delete).toHaveBeenCalledWith(sample.path.src);
	});

	test('Does nothing when both paths resolve to the same key', async () => {
		// 1. Clear the calls of the move run in `beforeEach` and make the destination resolve to the source key
		vi.mocked(driver.copy).mockClear();
		vi.mocked(driver.delete).mockClear();
		vi.mocked(driver['fullPath']).mockReturnValue(sample.path.srcFull);

		await driver.move(sample.path.src, sample.path.dest);

		// 2. With encryption configured S3 accepts a copy onto itself, so the delete would remove the only copy
		expect(driver.copy).not.toHaveBeenCalled();
		expect(driver.delete).not.toHaveBeenCalled();
	});
});

/**
 * The copy source the driver sends for a key: every segment URL-encoded, the slashes between them kept.
 *
 * @param key - The full key.
 * @returns The encoded key.
 */
const encodedKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

describe('#copy', () => {
	test('URL-encodes the reserved characters of the source key, segment by segment', async () => {
		// 1. S3 reads `x-amz-copy-source` URL-encoded: a raw `+` is a space, a raw `?` starts the version query
		driver['fullPath'] = vi.fn((input: string) =>
			input === 'a+b/c?d%e.png' ? 'media/a+b/c?d%e.png' : sample.path.destFull,
		);

		await driver.copy('a+b/c?d%e.png', sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith(
			expect.objectContaining({ CopySource: `/${sample.config.bucket}/media/a%2Bb/c%3Fd%25e.png` }),
		);
	});

	test('Constructs params object based on config', async () => {
		// 1. With the minimal config the request must carry no ACL or encryption headers, only the source and target keys
		await driver.copy(sample.path.src, sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.destFull,
			Bucket: sample.config.bucket,
			CopySource: `/${sample.config.bucket}/${encodedKey(sample.path.srcFull)}`,
		});
	});

	test('Optionally sets ServerSideEncryption', async () => {
		// 1. Encryption alone, with no KMS key id configured, so only the mode header may appear whatever the mode
		driver['config'].serverSideEncryption = sample.config.serverSideEncryption!;

		await driver.copy(sample.path.src, sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.destFull,
			Bucket: sample.config.bucket,
			CopySource: `/${sample.config.bucket}/${encodedKey(sample.path.srcFull)}`,
			ServerSideEncryption: sample.config.serverSideEncryption,
		});
	});

	test.each([[ServerSideEncryption.aws_kms], [ServerSideEncryption.aws_kms_dsse]])(
		'Optionally sets ServerSideEncryptionKMSKeyId ',
		async (sse) => {
			// 1. For the KMS modes the configured key id must travel with the mode
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.copy(sample.path.src, sample.path.dest);

			expect(CopyObjectCommand).toHaveBeenCalledWith({
				Key: sample.path.destFull,
				Bucket: sample.config.bucket,
				CopySource: `/${sample.config.bucket}/${encodedKey(sample.path.srcFull)}`,
				ServerSideEncryption: sse,
				SSEKMSKeyId: sample.config.serverSideEncryptionKmsKeyId,
			});
		},
	);

	test.each([[ServerSideEncryption.AES256], [ServerSideEncryption.aws_fsx]])(
		'Does not set ServerSideEncryptionKMSKeyId if ServerSideEncryption is not aws:kms or aws:kms:dsse',
		async (sse) => {
			// 1. For the non-KMS modes the key id must be dropped even though it is configured: S3 rejects it
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.copy(sample.path.src, sample.path.dest);

			expect(CopyObjectCommand).toHaveBeenCalledWith({
				Key: sample.path.destFull,
				Bucket: sample.config.bucket,
				CopySource: `/${sample.config.bucket}/${encodedKey(sample.path.srcFull)}`,
				ServerSideEncryption: sse,
				SSEKMSKeyId: undefined,
			});
		},
	);

	test('Optionally sets ACL', async () => {
		// 1. The ACL is restated on the copy, since S3 does not carry it over from the source object
		driver['config'].acl = sample.config.acl!;

		await driver.copy(sample.path.src, sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.destFull,
			Bucket: sample.config.bucket,
			CopySource: `/${sample.config.bucket}/${encodedKey(sample.path.srcFull)}`,
			ACL: sample.config.acl,
		});
	});

	test('Executes CopyObjectCommand', async () => {
		// 1. Stub the command constructor, so the exact instance handed to `send` can be asserted
		const mockCommand = {} as CopyObjectCommand;
		vi.mocked(CopyObjectCommand).mockReturnValue(mockCommand);

		await driver.copy(sample.path.src, sample.path.dest);

		expect(driver['client'].send).toHaveBeenCalledWith(mockCommand);
	});
});

describe('#write', () => {
	test('Passes streams to body as is', async () => {
		// 1. The stream must reach `Upload` untouched; buffering it would defeat streaming uploads
		await driver.write(sample.path.input, sample.stream);

		expect(Upload).toHaveBeenCalledWith({
			client: driver['client'],
			params: {
				Key: sample.path.inputFull,
				Bucket: sample.config.bucket,
				Body: sample.stream,
			},
		});
	});

	test('Optionally sets ContentType', async () => {
		// 1. The MIME type maps onto `ContentType`, which S3 later serves back as the object's Content-Type
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		expect(Upload).toHaveBeenCalledWith({
			client: driver['client'],
			params: {
				Key: sample.path.inputFull,
				Bucket: sample.config.bucket,
				Body: sample.stream,
				ContentType: sample.file.type,
			},
		});
	});

	test('Optionally sets ServerSideEncryption', async () => {
		// 1. Encryption alone, with no KMS key id configured, so only the mode header may appear whatever the mode
		driver['config'].serverSideEncryption = sample.config.serverSideEncryption!;

		await driver.write(sample.path.input, sample.stream);

		expect(Upload).toHaveBeenCalledWith({
			client: driver['client'],
			params: {
				Key: sample.path.inputFull,
				Bucket: sample.config.bucket,
				Body: sample.stream,
				ServerSideEncryption: sample.config.serverSideEncryption,
			},
		});
	});

	test.each([[ServerSideEncryption.aws_kms], [ServerSideEncryption.aws_kms_dsse]])(
		'Optionally sets ServerSideEncryptionKmsKeyId',
		async (sse) => {
			// 1. For the KMS modes the configured key id must travel with the mode
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.write(sample.path.input, sample.stream);

			expect(Upload).toHaveBeenCalledWith({
				client: driver['client'],
				params: {
					Key: sample.path.inputFull,
					Bucket: sample.config.bucket,
					Body: sample.stream,
					ServerSideEncryption: sse,
					SSEKMSKeyId: sample.config.serverSideEncryptionKmsKeyId,
				},
			});
		},
	);

	test.each([[ServerSideEncryption.aws_fsx], [ServerSideEncryption.AES256]])(
		'Does not set ServerSideEncryptionKmsKeyId when ServerSideEncryption is not aws:kms or aws:kms:dsse',
		async (sse) => {
			// 1. For the non-KMS modes the key id must be dropped even though it is configured: S3 rejects it
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.write(sample.path.input, sample.stream);

			expect(Upload).toHaveBeenCalledWith({
				client: driver['client'],
				params: {
					Key: sample.path.inputFull,
					Bucket: sample.config.bucket,
					Body: sample.stream,
					ServerSideEncryption: sse,
					SSEKMSKeyId: undefined,
				},
			});
		},
	);

	test('Optionally sets ACL', async () => {
		// 1. The ACL applies per object, so the configured value must be part of every write
		driver['config'].acl = sample.config.acl!;

		await driver.write(sample.path.input, sample.stream);

		expect(Upload).toHaveBeenCalledWith({
			client: driver['client'],
			params: {
				Key: sample.path.inputFull,
				Bucket: sample.config.bucket,
				Body: sample.stream,
				ACL: sample.config.acl,
			},
		});
	});

	test('Waits for upload to be done', async () => {
		// 1. `Upload` is auto-mocked, so a `done` has to be supplied to prove the driver awaits it
		const mockUpload = { done: vi.fn() };
		vi.mocked(Upload).mockReturnValue(mockUpload as unknown as Upload);

		await driver.write(sample.path.input, sample.stream);

		expect(mockUpload.done).toHaveBeenCalledOnce();
	});
});

describe('#delete', () => {
	test('Constructs params based on input', async () => {
		// 1. The key goes through `fullPath`; no version id is involved since the driver never enables versioning
		await driver.delete(sample.path.input);

		expect(DeleteObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
		});
	});

	test('Executes DeleteObjectCommand', async () => {
		// 1. Stub the command constructor, so the exact instance handed to `send` can be asserted
		const mockDeleteObjectCommand = {} as DeleteObjectCommand;
		vi.mocked(DeleteObjectCommand).mockReturnValue(mockDeleteObjectCommand);

		await driver.delete(sample.path.input);

		expect(driver['client'].send).toHaveBeenCalledWith(mockDeleteObjectCommand);
	});
});

describe('#call', () => {
	/**
	 * An error as the SDK throws it for an answer of S3: the auto-mocked exception class, its fields set by hand.
	 *
	 * @param status - The HTTP status S3 answered with.
	 * @param name - The error code S3 named.
	 * @returns The error.
	 */
	const serviceError = (status: number, name: string): S3ServiceException => {
		// 1. Built through the mocked class so `instanceof` in the driver holds; the constructor sets nothing itself
		const error = new S3ServiceException({ name, $fault: 'client', $metadata: {} });

		Object.assign(error, { name, message: `${name} happened`, $metadata: { httpStatusCode: status } });

		return error;
	};

	beforeEach(() => {
		// 1. The real deadline, so the timeout tests see a real `TimeoutError` and an aborted signal
		vi.mocked(withTimeout).mockImplementation(withTimeoutActual);
	});

	test('Sends the named command with the location bucket and answers the output without $metadata', async () => {
		// 1. The command instance handed to `send` is the one built from the caller's input and the default bucket
		const command = {} as GetBucketVersioningCommand;
		vi.mocked(GetBucketVersioningCommand).mockReturnValue(command);

		vi.mocked(driver['client'].send).mockResolvedValue({
			Status: 'Enabled',
			$metadata: { httpStatusCode: 200 },
		} as never);

		const result = await driver.call('GetBucketVersioning', { ExpectedBucketOwner: '123' });

		expect(GetBucketVersioningCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			ExpectedBucketOwner: '123',
		});

		expect(driver['client'].send).toHaveBeenCalledWith(command, { abortSignal: expect.any(AbortSignal) });
		expect(result).toStrictEqual({ status: 200, headers: {}, data: { Status: 'Enabled' } });
	});

	test('Accepts the Command suffix and a bucket of the caller', async () => {
		// 1. `PutBucketVersioningCommand` names the same class as `PutBucketVersioning`; a given bucket wins
		vi.mocked(driver['client'].send).mockResolvedValue({ $metadata: {} } as never);

		const result = await driver.call('PutBucketVersioningCommand', { Bucket: 'other' });

		expect(PutBucketVersioningCommand).toHaveBeenCalledWith({ Bucket: 'other' });
		expect(result).toStrictEqual({ status: 200, headers: {}, data: {} });
	});

	test.each(['NoSuchThing', 'getBucketVersioning', 'S3Client', 'GetBucketVersioning; x', ''])(
		'Refuses %j before anything is sent',
		async (method) => {
			// 1. Only commands the SDK exports run; the client is never reached
			await expect(driver.call(method)).rejects.toThrow('is not a command of @aws-sdk/client-s3');

			expect(driver['client'].send).not.toHaveBeenCalled();
		},
	);

	test('Refuses headers before anything is sent, rather than dropping them', async () => {
		// 1. The SDK builds and signs its own request; a header of the call or the location could never reach it
		await expect(driver.call('GetBucketVersioning', {}, { headers: { 'x-trace': '1' } })).rejects.toThrow(
			'S3 call() sends no extra headers; use the SDK client',
		);

		expect(driver['client'].send).not.toHaveBeenCalled();
	});

	test('Turns an answer of S3 into a ProviderCallError with its status and body', async () => {
		// 1. A 404 of S3 keeps its status and error code for the caller; no credential is in the message
		vi.mocked(driver['client'].send).mockRejectedValue(serviceError(404, 'NoSuchBucket') as never);

		const error = await driver.call('GetBucketVersioning').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toEqual({
			provider: 's3',
			method: 'GetBucketVersioning',
			status: 404,
			body: { name: 'NoSuchBucket', message: 'NoSuchBucket happened' },
		});

		expect((error as Error).message).not.toContain(sample.config.key);
		expect((error as Error).message).not.toContain(sample.config.secret);
	});

	test('Turns a 429 into a HitRateLimitError', async () => {
		// 1. S3 asking to slow down becomes the kit's rate-limit error
		vi.mocked(driver['client'].send).mockRejectedValue(serviceError(429, 'TooManyRequests') as never);

		await expect(driver.call('GetBucketVersioning')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test.each([
		[503, 'SlowDown'],
		[400, 'ThrottlingException'],
		[503, 'RequestLimitExceeded'],
		[400, 'TooManyRequestsException'],
	])('Turns a %s %s into a HitRateLimitError', async (status, name) => {
		// 1. S3 throttles with a 503 `SlowDown`, other AWS services with their own codes; each is the kit's 429
		vi.mocked(driver['client'].send).mockRejectedValue(serviceError(status, name) as never);

		const error = await driver.call('GetBucketVersioning').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(HitRateLimitError);
	});

	test('Keeps another 503 a ProviderCallError, without the SDK error as its cause', async () => {
		// 1. Only the throttling codes become a 429; the SDK's error, with its raw response, is not carried along
		vi.mocked(driver['client'].send).mockRejectedValue(serviceError(503, 'ServiceUnavailable') as never);

		const error = await driver.call('GetBucketVersioning').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect((error as InstanceType<typeof ProviderCallError>).extensions).toMatchObject({ status: 503 });
		expect((error as Error).cause).toBeUndefined();
	});

	test('Passes a failure that is not an answer of S3 on as it is', async () => {
		// 1. A network failure has no status to report
		const failure = new Error('socket hang up');
		vi.mocked(driver['client'].send).mockRejectedValue(failure as never);

		await expect(driver.call('GetBucketVersioning')).rejects.toBe(failure);
	});

	test('Gives up at the timeout of the caller and aborts the request', async () => {
		// 1. A command that never answers; the signal handed to the SDK is aborted at the deadline. The error is matched
		//    by shape, since `@novastarter/utils` — and the `TimeoutError` class it exports — is mocked in this file
		let abortSignal: AbortSignal | undefined;

		vi.mocked(driver['client'].send).mockImplementation(((_command: unknown, options: { abortSignal: AbortSignal }) => {
			abortSignal = options.abortSignal;

			return new Promise(() => {});
		}) as never);

		await expect(driver.call('GetBucketVersioning', {}, { timeout: 5 })).rejects.toMatchObject({
			name: 'TimeoutError',
			ms: 5,
		});

		expect(abortSignal?.aborted).toBe(true);
	});
});

describe('#close', () => {
	test('Destroys the SDK client', async () => {
		// 1. The auto-mocked S3Client records the call; nothing else is released
		await driver.close();

		expect(driver['client'].destroy).toHaveBeenCalledOnce();
	});
});

describe('#list', () => {
	test('Constructs list objects params based on input prefix', async () => {
		// 1. An empty page ends the generator after one request, so a single `next()` is enough to trigger it
		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await driver.list(sample.path.input).next();

		// 2. `MaxKeys` is pinned to the S3 page maximum, so large prefixes take as few round trips as possible
		expect(ListObjectsV2Command).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Prefix: sample.path.inputFull,
			MaxKeys: 1000,
		});
	});

	test('Calls send with the command', async () => {
		// 1. Stub the command constructor and answer with an empty page, so one `next()` triggers exactly one send
		const mockListObjectsV2Command = {} as ListObjectsV2Command;
		vi.mocked(ListObjectsV2Command).mockReturnValue(mockListObjectsV2Command);
		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await driver.list(sample.path.input).next();

		expect(driver['client'].send).toHaveBeenCalledWith(mockListObjectsV2Command);
	});

	test('Yields file Key omitting root', async () => {
		// 1. Build the key as `root/file`, so stripping the root and its slash must yield exactly `file`; a leading
		//    slash on the yielded path would not be the form a caller passes in
		const sampleRoot = randDirectoryPath();
		const sampleFile = randFilePath().replace(/^\/+/, '');
		const sampleFull = `${sampleRoot}/${sampleFile}`;

		vi.mocked(driver['client'].send).mockResolvedValue({
			Contents: [
				{
					Key: sampleFull,
				},
			],
		} as unknown as void);

		// 2. Set the root directly: the shared driver was built without one
		// @ts-expect-error - mutating private attribute
		driver['root'] = sampleRoot;

		// 3. Drain the generator; the single key must come back with the root stripped
		const iterator = driver.list(sample.path.input);

		const output = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([sampleFile]);
	});

	test('Continuously fetches until all pages are returned', async () => {
		// 1. Three pages: the first two carry a continuation token, the last one does not, which must end the loop
		vi.mocked(driver['client'].send)
			.mockResolvedValueOnce({
				NextContinuationToken: randWord(),
				Contents: [
					{
						Key: randFilePath(),
					},
					{
						Key: randFilePath(),
					},
				],
			} as unknown as void)
			.mockResolvedValueOnce({
				NextContinuationToken: randWord(),
				Contents: [
					{
						Key: randFilePath(),
					},
				],
			} as unknown as void)
			.mockResolvedValueOnce({
				NextContinuationToken: undefined,
				Contents: [
					{
						Key: randFilePath(),
					},
				],
			} as unknown as void);

		// 2. Draining the generator must issue one request per page and yield every key across them
		const iterator = driver.list(sample.path.input);

		const output = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(driver['client'].send).toHaveBeenCalledTimes(3);
		expect(output.length).toBe(4);
	});
});

describe('#createChunkedUpload', () => {
	beforeEach(() => {
		// 1. The driver copies `UploadId` from the response into the context, so the mock has to return one
		vi.mocked(driver['client'].send).mockResolvedValue({
			UploadId: 'test-upload-id',
		} as unknown as void);
	});

	test('Creates the metadata map when the context has none and keeps the upload id in it', async () => {
		// 1. A POST without `Upload-Metadata` hands over no map; the id must still be stored, or the upload S3 just
		//    opened could never be continued or aborted
		const context = { metadata: undefined };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result).toBe(context);
		expect(result.metadata).toStrictEqual({ 'upload-id': 'test-upload-id' });

		expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Metadata: { 'tus-version': '1.0.0' },
		});
	});

	test('Forwards the content headers from the metadata and adds the upload id next to them', async () => {
		// 1. S3 only takes `ContentType` and `CacheControl` when the upload is created, so both must travel with the
		//    create request; the id is added to the same map the client keys live in
		const context = { metadata: { contentType: sample.file.type, cacheControl: 'max-age=60' } };

		await driver.createChunkedUpload(sample.path.input, context);

		expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Metadata: { 'tus-version': '1.0.0' },
			ContentType: sample.file.type,
			CacheControl: 'max-age=60',
		});

		expect(context.metadata).toMatchObject({ 'upload-id': 'test-upload-id' });
	});

	test.each([[ServerSideEncryption.aws_kms], [ServerSideEncryption.aws_kms_dsse]])(
		'Optionally sets ServerSideEncryptionKMSKeyId ',
		async (sse) => {
			// 1. For the KMS modes the configured key id must travel with the mode; empty metadata adds no content headers
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.createChunkedUpload(sample.path.input, { metadata: {} });

			expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
				Bucket: sample.config.bucket,
				Key: sample.path.inputFull,
				Metadata: { 'tus-version': '1.0.0' },
				ServerSideEncryption: sse,
				SSEKMSKeyId: sample.config.serverSideEncryptionKmsKeyId,
			});
		},
	);

	test.each([[ServerSideEncryption.AES256], [ServerSideEncryption.aws_fsx]])(
		'Does not set SSEKMSKeyId if ServerSideEncryption is not aws:kms or aws:kms:dsse',
		async (sse) => {
			// 1. For the non-KMS modes the key id must be dropped even though it is configured: S3 rejects it
			driver['config'].serverSideEncryption = sse;
			driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

			await driver.createChunkedUpload(sample.path.input, { metadata: {} });

			expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
				Bucket: sample.config.bucket,
				Key: sample.path.inputFull,
				Metadata: { 'tus-version': '1.0.0' },
				ServerSideEncryption: sse,
				SSEKMSKeyId: undefined,
			});
		},
	);

	test('Sets the configured canned ACL on the create request', async () => {
		// 1. S3 takes the ACL only when the multipart upload is created, so a TUS upload gets it here or not at all
		driver['config'].acl = 'public-read';

		await driver.createChunkedUpload(sample.path.input, { metadata: {} });

		expect(CreateMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Metadata: { 'tus-version': '1.0.0' },
			ACL: 'public-read',
		});
	});
});

describe('#deleteChunkedUpload', () => {
	const uploadId = 'test-upload-id';
	const context = { metadata: { 'upload-id': uploadId } };

	/**
	 * Abort failure shaped the way the SDK reports an upload S3 no longer knows.
	 *
	 * @returns The error to reject the abort with.
	 */
	const noSuchUpload = () =>
		Object.assign(new Error('NoSuchUpload'), { name: 'NoSuchUpload', $metadata: { httpStatusCode: 404 } });

	beforeEach(() => {
		// 1. The lookup is stubbed, so each test states whether an object sits under the key without a HEAD round trip
		driver.exists = vi.fn().mockResolvedValue(true);
		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);
	});

	test('Aborts a live upload and keeps the object it was meant to replace', async () => {
		// 1. A live upload: the abort answers, so the upload never wrote the key and the object there is an older file
		//    that a cancelled replacement must not destroy
		await driver.deleteChunkedUpload(sample.path.input, context);

		expect(AbortMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			UploadId: uploadId,
		});

		expect(driver.exists).not.toHaveBeenCalled();
		expect(DeleteObjectCommand).not.toHaveBeenCalled();
	});

	test('Still removes the object when the upload was completed before', async () => {
		// 1. After completion S3 answers the abort with `NoSuchUpload`, yet the assembled object is there: a termination
		//    must remove it instead of answering 404 and leaving the file behind
		vi.mocked(driver['client'].send).mockRejectedValueOnce(noSuchUpload() as never);

		await driver.deleteChunkedUpload(sample.path.input, context);

		expect(driver.exists).toHaveBeenCalledWith(sample.path.input);

		expect(DeleteObjectCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
		});
	});

	test('Rejects when S3 refuses to delete the object', async () => {
		// 1. The single-object delete throws on a refusal, so the termination fails instead of reporting a success
		//    while the file stays in the bucket
		const denied = Object.assign(new Error('AccessDenied'), {
			name: 'AccessDenied',
			$metadata: { httpStatusCode: 403 },
		});

		vi.mocked(driver['client'].send)
			.mockRejectedValueOnce(noSuchUpload() as never)
			.mockRejectedValueOnce(denied as never);

		await expect(driver.deleteChunkedUpload(sample.path.input, context)).rejects.toBe(denied);
	});

	test('Throws the TUS not-found error when neither the upload nor an object exists', async () => {
		// 1. Nothing to abort and nothing under the key: the TUS server answers 404, and no delete is sent for nothing
		vi.mocked(driver['client'].send).mockRejectedValueOnce(noSuchUpload() as never);
		vi.mocked(driver.exists).mockResolvedValue(false);

		await expect(driver.deleteChunkedUpload(sample.path.input, context)).rejects.toBe(ERRORS.FILE_NOT_FOUND);
		expect(DeleteObjectCommand).not.toHaveBeenCalled();
	});

	test('Checks for the object when no upload id was ever recorded', async () => {
		// 1. Without an id there is nothing to abort, so the object is what decides between a delete and a 404
		vi.mocked(driver.exists).mockResolvedValue(false);

		await expect(driver.deleteChunkedUpload(sample.path.input, { metadata: undefined })).rejects.toBe(
			ERRORS.FILE_NOT_FOUND,
		);

		expect(AbortMultipartUploadCommand).not.toHaveBeenCalled();
	});

	test('Rethrows any other abort failure without touching the object', async () => {
		// 1. A denied abort says nothing about the upload; deleting the object on top of it would destroy data the
		//    caller was not allowed to touch
		const denied = Object.assign(new Error('AccessDenied'), {
			name: 'AccessDenied',
			$metadata: { httpStatusCode: 403 },
		});

		vi.mocked(driver['client'].send).mockRejectedValueOnce(denied as never);

		await expect(driver.deleteChunkedUpload(sample.path.input, context)).rejects.toBe(denied);
		expect(DeleteObjectCommand).not.toHaveBeenCalled();
	});
});

describe('#finishChunkedUpload', () => {
	const uploadId = 'test-upload-id';
	const partSize = 1000;
	const context = { metadata: { 'upload-id': uploadId }, size: 3 * partSize };

	/**
	 * `ListParts` response with one part per given size, numbered from one.
	 *
	 * @param sizes - Size of each listed part.
	 * @returns What the mocked `send` resolves to for the listing.
	 */
	const listing = (...sizes: number[]) => ({
		Parts: sizes.map((size, index) => ({ PartNumber: index + 1, ETag: `etag-${index + 1}`, Size: size })),
		IsTruncated: false,
	});

	beforeEach(() => {
		vi.useFakeTimers();

		// 1. `retry` is auto-mocked with the rest of utils; the real one runs here, since its pacing is what is tested
		vi.mocked(retry).mockImplementation(retryActual);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('Completes the upload once the listing shows every part', async () => {
		// 1. A full listing on the first call: no pause, one listing, and every part handed to the completion in order
		vi.mocked(driver['client'].send).mockResolvedValue(listing(partSize, partSize, partSize) as unknown as void);

		await driver.finishChunkedUpload(sample.path.input, context);

		expect(ListPartsCommand).toHaveBeenCalledTimes(1);

		expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			UploadId: uploadId,
			MultipartUpload: {
				Parts: [
					{ ETag: 'etag-1', PartNumber: 1 },
					{ ETag: 'etag-2', PartNumber: 2 },
					{ ETag: 'etag-3', PartNumber: 3 },
				],
			},
		});
	});

	test('Completes an upload of uneven parts once their bytes add up to the size', async () => {
		// 1. A client whose requests do not line up with the part size leaves more, smaller parts than the size divided
		//    by the part size predicts; the bytes are what count, so four parts summing to the size complete at once
		vi.mocked(driver['client'].send).mockResolvedValue(
			listing(partSize, partSize, partSize / 2, partSize / 2) as unknown as void,
		);

		await driver.finishChunkedUpload(sample.path.input, context);

		expect(ListPartsCommand).toHaveBeenCalledTimes(1);

		expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				MultipartUpload: {
					Parts: [
						{ ETag: 'etag-1', PartNumber: 1 },
						{ ETag: 'etag-2', PartNumber: 2 },
						{ ETag: 'etag-3', PartNumber: 3 },
						{ ETag: 'etag-4', PartNumber: 4 },
					],
				},
			}),
		);
	});

	test('Keeps polling while the bytes fall short even when the part count would match', async () => {
		// 1. Three parts that are still a half part short must not pass for complete; the fourth part shows up on the
		//    second listing and only then is the completion sent
		vi.mocked(driver['client'].send)
			.mockResolvedValueOnce(listing(partSize, partSize, partSize / 2) as unknown as void)
			.mockResolvedValue(listing(partSize, partSize, partSize / 2, partSize / 2) as unknown as void);

		const run = driver.finishChunkedUpload(sample.path.input, context);

		await vi.advanceTimersByTimeAsync(500);
		await run;

		expect(ListPartsCommand).toHaveBeenCalledTimes(2);
		expect(CompleteMultipartUploadCommand).toHaveBeenCalledTimes(1);
	});

	test('Polls the listing with growing pauses until every part shows', async () => {
		// 1. Two short listings, then a full one: the completion goes out after 0.5 s + 1 s of waiting
		vi.mocked(driver['client'].send)
			.mockResolvedValueOnce(listing(partSize, partSize) as unknown as void)
			.mockResolvedValueOnce(listing(partSize, partSize) as unknown as void)
			.mockResolvedValue(listing(partSize, partSize, partSize) as unknown as void);

		const run = driver.finishChunkedUpload(sample.path.input, context);

		await vi.advanceTimersByTimeAsync(1500);
		await run;

		expect(ListPartsCommand).toHaveBeenCalledTimes(3);
		expect(CompleteMultipartUploadCommand).toHaveBeenCalledTimes(1);
	});

	test('Refuses with the TUS error object when parts are still missing after three retries', async () => {
		// 1. Four short listings — the first attempt and three retries — and nothing is completed
		vi.mocked(driver['client'].send).mockResolvedValue(listing(partSize, partSize) as unknown as void);

		const run = driver.finishChunkedUpload(sample.path.input, context);
		const outcome = run.catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(500 + 1000 + 1500);

		await expect(outcome).resolves.toEqual({ status_code: 500, body: 'Failed to upload all parts to S3.' });
		expect(ListPartsCommand).toHaveBeenCalledTimes(4);
		expect(CompleteMultipartUploadCommand).not.toHaveBeenCalled();
	});

	test('Leaves out parts past the size that a failed chunk left behind', async () => {
		// 1. Parts 1 and 2 hold the whole upload; part 3 is a leftover of a chunk that failed half-way and was resent
		//    in fewer parts, so it is not completed and S3 discards it instead of the listing never adding up
		vi.mocked(driver['client'].send).mockResolvedValue(listing(2 * partSize, partSize, partSize) as unknown as void);

		await driver.finishChunkedUpload(sample.path.input, context);

		expect(ListPartsCommand).toHaveBeenCalledTimes(1);

		expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				MultipartUpload: {
					Parts: [
						{ ETag: 'etag-1', PartNumber: 1 },
						{ ETag: 'etag-2', PartNumber: 2 },
					],
				},
			}),
		);
	});

	test('Throws a failing listing at once, without retrying it', async () => {
		// 1. A rejected `ListParts` is a real error, not a listing that lags: it goes out as it is after one call
		const failure = new Error('connection reset');

		vi.mocked(driver['client'].send).mockRejectedValue(failure);

		await expect(driver.finishChunkedUpload(sample.path.input, context)).rejects.toBe(failure);
		expect(ListPartsCommand).toHaveBeenCalledTimes(1);
		expect(CompleteMultipartUploadCommand).not.toHaveBeenCalled();
	});

	test('Writes an empty object directly when the upload has a zero size', async () => {
		// 1. A zero-length upload produces no parts, and S3 refuses `CompleteMultipartUpload` with an empty `Parts`
		//    list; the multipart upload is aborted and the empty object is written with a plain PutObject instead
		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await driver.finishChunkedUpload(sample.path.input, { metadata: { 'upload-id': uploadId }, size: 0 });

		// 2. The completion is never attempted with an empty parts list, and no listing is polled for nothing
		expect(ListPartsCommand).not.toHaveBeenCalled();
		expect(CompleteMultipartUploadCommand).not.toHaveBeenCalled();

		expect(AbortMultipartUploadCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			UploadId: uploadId,
		});

		expect(PutObjectCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Body: Buffer.alloc(0),
		});
	});

	test('Restates the content headers and encryption on the empty object', async () => {
		// 1. The client-sent headers and the encryption settings only travel with the create request on the multipart
		//    path, so the empty write must carry them again for the object to come out as configured
		driver['config'].serverSideEncryption = ServerSideEncryption.aws_kms;
		driver['config'].serverSideEncryptionKmsKeyId = sample.config.serverSideEncryptionKmsKeyId!;

		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await driver.finishChunkedUpload(sample.path.input, {
			metadata: { 'upload-id': uploadId, contentType: sample.file.type, cacheControl: 'max-age=60' },
			size: 0,
		});

		expect(PutObjectCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Body: Buffer.alloc(0),
			ContentType: sample.file.type,
			CacheControl: 'max-age=60',
			ServerSideEncryption: ServerSideEncryption.aws_kms,
			SSEKMSKeyId: sample.config.serverSideEncryptionKmsKeyId,
		});
	});

	test('Sets the configured canned ACL on the empty object', async () => {
		// 1. The empty object is created by the PutObject, so the ACL must travel with it like on the multipart path
		driver['config'].acl = 'public-read';

		vi.mocked(driver['client'].send).mockResolvedValue({} as unknown as void);

		await driver.finishChunkedUpload(sample.path.input, { metadata: { 'upload-id': uploadId }, size: 0 });

		expect(PutObjectCommand).toHaveBeenCalledWith({
			Bucket: sample.config.bucket,
			Key: sample.path.inputFull,
			Body: Buffer.alloc(0),
			ACL: 'public-read',
		});
	});
});

describe('#writeChunk', () => {
	const uploadId = 'test-upload-id';
	const context = { metadata: { 'upload-id': uploadId }, size: 100 };

	beforeEach(() => {
		// 1. Both halves are stubbed: the listing decides the next part number, the part upload reports the bytes
		driver['retrieveParts'] = vi.fn().mockResolvedValue([
			{ PartNumber: 1, Size: 5 },
			{ PartNumber: 2, Size: 5 },
		]);

		driver['uploadParts'] = vi.fn().mockResolvedValue(7);
	});

	test('Continues after the highest listed part and reports the bytes S3 accepted', async () => {
		// 1. S3 is the record of which parts exist, so the next number follows the last listed one; the new offset is
		//    the requested one plus what the upload accepted, not the chunk length
		await expect(driver.writeChunk(sample.path.input, sample.stream, 10, context)).resolves.toBe(17);

		expect(driver['retrieveParts']).toHaveBeenCalledWith(sample.path.inputFull, uploadId);
		expect(driver['uploadParts']).toHaveBeenCalledWith(sample.path.inputFull, uploadId, 100, sample.stream, 3, 10);
	});

	test('Numbers the parts from the offset, over parts a failed chunk left past it', async () => {
		// 1. Parts 3 and 4 reached S3 before a sibling part failed, so the chunk threw and the offset stayed at 10. The
		//    resent chunk goes into part 3 again, overwriting the leftovers instead of storing the same bytes twice
		vi.mocked(driver['retrieveParts']).mockResolvedValue([
			{ PartNumber: 1, Size: 5 },
			{ PartNumber: 2, Size: 5 },
			{ PartNumber: 3, Size: 5 },
			{ PartNumber: 4, Size: 5 },
		]);

		await expect(driver.writeChunk(sample.path.input, sample.stream, 10, context)).resolves.toBe(17);

		expect(driver['uploadParts']).toHaveBeenCalledWith(sample.path.inputFull, uploadId, 100, sample.stream, 3, 10);
	});

	test('Numbers the parts from the offset when a failed chunk left a gap', async () => {
		// 1. Part 3 failed while part 4 landed: the gap means part 4 holds bytes out of order, so the resent chunk
		//    starts again at part 3 and overwrites part 4 as it goes
		vi.mocked(driver['retrieveParts']).mockResolvedValue([
			{ PartNumber: 1, Size: 5 },
			{ PartNumber: 2, Size: 5 },
			{ PartNumber: 4, Size: 5 },
		]);

		await driver.writeChunk(sample.path.input, sample.stream, 10, context);

		expect(driver['uploadParts']).toHaveBeenCalledWith(sample.path.inputFull, uploadId, 100, sample.stream, 3, 10);
	});

	test('Follows the highest part when the listing does not reach the offset', async () => {
		// 1. A listing that lags behind the offset cannot say where the offset falls, so the number follows the last
		//    listed part as before
		vi.mocked(driver['retrieveParts']).mockResolvedValue([{ PartNumber: 1, Size: 5 }]);

		await driver.writeChunk(sample.path.input, sample.stream, 10, context);

		expect(driver['uploadParts']).toHaveBeenCalledWith(sample.path.inputFull, uploadId, 100, sample.stream, 2, 10);
	});

	test('Lets a failure of the part upload through unchanged', async () => {
		// 1. The TUS-shaped refusal of a chunk that could not be stored has to reach the server as it is, so it becomes
		//    the HTTP response
		const refusal = { status_code: 400, body: 'too short' };
		vi.mocked(driver['uploadParts']).mockRejectedValue(refusal);

		await expect(driver.writeChunk(sample.path.input, sample.stream, 10, context)).rejects.toBe(refusal);
	});

	test('Accepts a chunk while the length is still deferred', async () => {
		// 1. A deferred-length upload has no total yet; the size passes through as `undefined`, so the parts are sized
		//    for the largest object S3 allows and no part is treated as the final one
		const context = { metadata: { 'upload-id': uploadId }, size: undefined };

		await expect(driver.writeChunk(sample.path.input, sample.stream, 10, context)).resolves.toBe(17);

		expect(driver['uploadParts']).toHaveBeenCalledWith(
			sample.path.inputFull,
			uploadId,
			undefined,
			sample.stream,
			3,
			10,
		);
	});
});

describe('#calcOptimalPartSize', () => {
	test('Plans for the largest object when the size is unknown', () => {
		// 1. A deferred-length upload must never overflow the part count, so the part size grows to fit the S3 maximum
		expect(driver['calcOptimalPartSize'](undefined)).toBe(Math.ceil(driver.maxUploadSize / driver.maxMultipartParts));
	});
});

describe('#uploadParts', () => {
	const uploadId = 'test-upload-id';
	const key = 'uploads/file.bin';
	const partSize = 10;

	/**
	 * Let the event loop turn, so stream and semaphore callbacks queued so far run.
	 *
	 * @returns Once pending callbacks had their turn.
	 */
	const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

	beforeEach(() => {
		// 1. Tiny parts, so the real splitter cuts a few bytes the way it cuts megabytes; the part upload is stubbed,
		//    since only the bookkeeping around it is under test
		driver['calcOptimalPartSize'] = vi.fn().mockReturnValue(partSize);
		driver['uploadPart'] = vi.fn().mockResolvedValue('etag');

		// @ts-expect-error - the minimum is typed as the S3 constant; lowered to match the tiny parts
		driver['minPartSize'] = partSize;
	});

	test('Sends the full parts and skips a short trailing one without opening its file', async () => {
		// 1. Seventeen bytes cut at ten: the first part is sent, the seven-byte remainder is not final and too short,
		//    so it is left out of the count and no read stream is ever opened over its file
		const createReadStream = vi.spyOn(fs, 'createReadStream');
		const source = Readable.from([Buffer.alloc(17, 'a')]);

		const bytes = await driver['uploadParts'](key, uploadId, 100, source, 1, 0);

		expect(bytes).toBe(10);
		expect(driver['uploadPart']).toHaveBeenCalledTimes(1);
		expect(driver['uploadPart']).toHaveBeenCalledWith(key, uploadId, expect.any(fs.ReadStream), 1);
		expect(createReadStream).toHaveBeenCalledTimes(1);
	});

	test('Sends a short part when it is the last one of the upload', async () => {
		// 1. The last part may be smaller than the minimum: seven bytes at offset 93 of a 100-byte upload go out
		const source = Readable.from([Buffer.alloc(7, 'a')]);

		const bytes = await driver['uploadParts'](key, uploadId, 100, source, 4, 93);

		expect(bytes).toBe(7);
		expect(driver['uploadPart']).toHaveBeenCalledWith(key, uploadId, expect.any(fs.ReadStream), 4);
	});

	test('Skips a short trailing part while the length is deferred', async () => {
		// 1. With an unknown size no part can be recognised as the final one, so a trailing part under the minimum is
		//    skipped like any non-final part and the client resends those bytes once the length is declared
		const createReadStream = vi.spyOn(fs, 'createReadStream');
		const source = Readable.from([Buffer.alloc(17, 'a')]);

		const bytes = await driver['uploadParts'](key, uploadId, undefined, source, 1, 0);

		expect(bytes).toBe(10);
		expect(driver['uploadPart']).toHaveBeenCalledTimes(1);
		expect(createReadStream).toHaveBeenCalledTimes(1);
	});

	test('Destroys the read stream when the part upload rejects', async () => {
		// 1. A rejected `UploadPart` leaves the file half-read; the stream must be destroyed so the descriptor is
		//    closed, or every failed part would hold one open until the process exits
		const failure = new Error('RequestTimeout');
		vi.mocked(driver['uploadPart']).mockRejectedValue(failure);

		const source = Readable.from([Buffer.alloc(10, 'a')]);

		await expect(driver['uploadParts'](key, uploadId, 100, source, 1, 0)).rejects.toBe(failure);

		const readable = vi.mocked(driver['uploadPart']).mock.calls[0]![2] as fs.ReadStream;

		expect(readable.destroyed).toBe(true);
	});

	test('Handles a part-upload failure that lands while the chunk is still streaming', async () => {
		// 1. Fifteen bytes cut at ten: the first part's upload rejects at once, while the rest of the chunk is still
		//    open on disk — with the rejection unhandled until the pipeline settles, Node's default
		//    `unhandledRejection: 'throw'` would crash the process before the error could reach the caller
		const failure = new Error('SlowDown');

		vi.mocked(driver['uploadPart']).mockRejectedValueOnce(failure).mockResolvedValue('etag');

		const source = new PassThrough();

		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);

		try {
			const run = driver['uploadParts'](key, uploadId, 100, source, 1, 0);

			// 2. The first ten bytes finalize the first part; its upload fails while the pipeline is still waiting
			//    for the rest of the chunk
			source.write(Buffer.alloc(15, 'a'));

			await vi.waitFor(() => expect(driver['uploadPart']).toHaveBeenCalledTimes(1));

			// 3. Give a rejection nobody handles every chance to surface before the chunk completes
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(unhandled).toStrictEqual([]);

			source.end();

			// 4. The part failure still reaches the caller unchanged once the pipeline settles
			await expect(run).rejects.toBe(failure);
			expect(unhandled).toStrictEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	test('Refuses a chunk that finished with every byte unsent', async () => {
		// 1. Seven bytes that are not the last of the upload: nothing can be sent, and returning the unchanged offset
		//    would make the client resend the same chunk forever, so the chunk is refused in the TUS shape
		const source = Readable.from([Buffer.alloc(7, 'a')]);

		await expect(driver['uploadParts'](key, uploadId, 100, source, 1, 0)).rejects.toEqual({
			status_code: 400,
			body: `A chunk of 7 bytes cannot be stored: every request but the last has to carry at least ${partSize} bytes.`,
		});

		expect(driver['uploadPart']).not.toHaveBeenCalled();
	});

	test('Turns back a permit granted after the pipeline failed and opens no part file for it', async () => {
		// 1. One permit, already taken: the first part of the chunk has to wait for it
		const semaphore = new Semaphore(1);
		const held = await semaphore.acquire();
		driver['partUploadSemaphore'] = semaphore;

		const open = vi.spyOn(fsPromises, 'open');
		const source = new PassThrough();
		const run = driver['uploadParts'](key, uploadId, 100, source, 1, 0);

		// 2. The stream dies while the part is still waiting; the pipeline error is what the caller gets
		source.write(Buffer.alloc(4, 'a'));
		await tick();
		source.destroy(new Error('connection reset'));

		await expect(run).rejects.toThrow('connection reset');

		// 3. The permit is granted only now, to a part nobody will consume: it must go straight back and no temp
		//    file may be opened, or sixty such events would stall every later upload on this driver
		await held.release();
		await tick();

		expect(semaphore['availablePermits']).toBe(1);
		expect(open).not.toHaveBeenCalled();
	});

	test('Keeps a part permit checked out until its upload settles, even when another chunk fails', async () => {
		// 1. One permit shared by the whole driver: the first part holds it through an upload the test controls, so
		//    every later part of every upload on this driver waits for it
		const semaphore = new Semaphore(1);
		driver['partUploadSemaphore'] = semaphore;

		// 2. Both uploads hang until the test releases them, so a permit wrongly freed mid-failure would visibly admit
		//    the second upload before the first one settles
		/**
		 * Finish the first upload's part with an ETag; a no-op until the part's own resolver replaces it.
		 */
		let finishFirst: (etag: string) => void = () => {};

		/**
		 * Finish the second upload's part with an ETag; a no-op until the part's own resolver replaces it.
		 */
		let finishSecond: (etag: string) => void = () => {};

		vi.mocked(driver['uploadPart'])
			.mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
			.mockImplementation(() => new Promise<string>((resolve) => (finishSecond = resolve)));

		const source1 = new PassThrough();
		const run1 = driver['uploadParts'](key, uploadId, 100, source1, 1, 0);

		// 3. Fifteen bytes cut at ten: the first part is complete and its upload hangs onto the only permit, while the
		//    remainder waits for a permit before its part file is opened
		source1.write(Buffer.alloc(15, 'a'));
		await vi.waitFor(() => expect(driver['uploadPart']).toHaveBeenCalledTimes(1));

		// 4. A second upload arrives and its part must wait for the permit, since the first upload is still in flight
		const source2 = new PassThrough();
		const run2 = driver['uploadParts'](key, uploadId, 100, source2, 1, 0);
		source2.write(Buffer.alloc(10, 'a'));
		source2.end();
		await tick();

		// 5. The first chunk dies while its part uploads: the failure must not free the in-flight part's permit, or the
		//    waiting upload would be admitted while the first upload is still running, past the concurrency cap. The
		//    pause gives a wrongly freed permit every chance to surface through the real file system instead of
		//    racing past it
		source1.destroy(new Error('connection reset'));

		await expect(run1).rejects.toThrow('connection reset');
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(driver['uploadPart']).toHaveBeenCalledTimes(1);

		// 6. The permit comes back when the in-flight upload settles, and only then does the waiting upload proceed
		finishFirst('etag');
		await vi.waitFor(() => expect(driver['uploadPart']).toHaveBeenCalledTimes(2));

		finishSecond('etag');
		await expect(run2).resolves.toBe(10);
	});
});
