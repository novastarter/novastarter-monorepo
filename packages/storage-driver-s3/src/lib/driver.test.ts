/**
 * Tests of `storage-driver-s3/lib/driver`.
 */
import { PassThrough, Readable } from 'node:stream';
import type { HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import {
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	S3Client,
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
import { StorageFileNotFoundError } from '@novastarter/storage';
import { joinPath, normalizePath, retry } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverS3Config } from './driver.js';
import { StorageDriverS3 } from './driver.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/utils/node');
vi.mock('@novastarter/utils');
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/lib-storage');

const { retry: retryActual } = await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

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
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		// 1. `normalizePath` is auto-mocked; a fixed return value shows the driver stores the normalised result, not the raw root
		const mockRoot = randDirectoryPath();

		vi.mocked(normalizePath).mockReturnValue(mockRoot);

		const driver = new StorageDriverS3({
			key: sample.config.key,
			secret: sample.config.secret,
			bucket: sample.config.bucket,
			root: sample.config.root,
		});

		// 2. `removeLeading` must be requested: a key with a leading slash would never match the expected object names
		expect(normalizePath).toHaveBeenCalledWith(sample.config.root, {
			removeLeading: true,
		});

		expect(driver['root']).toBe(mockRoot);
	});
});

describe('#getClient', () => {
	// The constructor calls getClient(), so we don't have to call it separately

	test('Throws error if bucket missing', () => {
		// 1. Every command targets the bucket, so its absence is refused at construction rather than on the first request
		expect(() => new StorageDriverS3({ bucket: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The s3 storage driver needs a "bucket"]`,
		);
	});

	test('Throws error if key defined but secret missing', () => {
		// 1. The constructor builds the client, so half a credential pair must throw before any client exists
		try {
			new StorageDriverS3({ key: 'key', bucket: 'bucket' });
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('The s3 storage driver needs "key" and "secret" together');
		}
	});

	test('Throws error if secret defined but key missing', () => {
		// 1. The constructor builds the client, so half a credential pair must throw before any client exists
		try {
			new StorageDriverS3({ secret: 'secret', bucket: 'bucket' });
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('The s3 storage driver needs "key" and "secret" together');
		}
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

		// 3. Point the driver at a root, since the shared config leaves it empty
		// @ts-expect-error - mutating private attribute
		driver['root'] = sample.config.root;

		// 4. `joinPath` must get root and path in that order, and its result is the key
		const result = driver['fullPath'](sample.path.input);

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
		// 1. Only `end` set: the header becomes `bytes=-end`, which S3 reads as a suffix range (the last N bytes)
		await driver.read(sample.path.input, { range: { end: sample.range.end } });

		expect(GetObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.inputFull,
			Bucket: sample.config.bucket,
			Range: `bytes=-${sample.range.end}`,
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

		try {
			await driver.read(sample.path.input, { range: sample.range });
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
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
		expect(driver.copy).toHaveBeenCalledWith(sample.path.src, sample.path.dest);
	});

	test('Calls delete on successful copy', async () => {
		expect(driver.delete).toHaveBeenCalledWith(sample.path.src);
	});
});

describe('#copy', () => {
	test('Constructs params object based on config', async () => {
		// 1. With the minimal config the request must carry no ACL or encryption headers, only the source and target keys
		await driver.copy(sample.path.src, sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.destFull,
			Bucket: sample.config.bucket,
			CopySource: `/${sample.config.bucket}/${sample.path.srcFull}`,
		});
	});

	test('Optionally sets ServerSideEncryption', async () => {
		// 1. Encryption alone, with no KMS key id configured, so only the mode header may appear whatever the mode
		driver['config'].serverSideEncryption = sample.config.serverSideEncryption!;

		await driver.copy(sample.path.src, sample.path.dest);

		expect(CopyObjectCommand).toHaveBeenCalledWith({
			Key: sample.path.destFull,
			Bucket: sample.config.bucket,
			CopySource: `/${sample.config.bucket}/${sample.path.srcFull}`,
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
				CopySource: `/${sample.config.bucket}/${sample.path.srcFull}`,
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
				CopySource: `/${sample.config.bucket}/${sample.path.srcFull}`,
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
			CopySource: `/${sample.config.bucket}/${sample.path.srcFull}`,
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
		// 1. Build the key as `root + file`, so stripping the root must yield exactly `file`
		const sampleRoot = randDirectoryPath();
		const sampleFile = randFilePath();
		const sampleFull = `${sampleRoot}${sampleFile}`;

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
});

describe('#finishChunkedUpload', () => {
	const uploadId = 'test-upload-id';
	const chunkSize = 1000;
	const context = { metadata: { 'upload-id': uploadId }, size: 3 * chunkSize };

	/**
	 * `ListParts` response with the given number of parts, numbered from one.
	 *
	 * @param count - Parts to list.
	 * @returns What the mocked `send` resolves to for the listing.
	 */
	const listing = (count: number) => ({
		Parts: Array.from({ length: count }, (_, index) => ({ PartNumber: index + 1, ETag: `etag-${index + 1}` })),
		IsTruncated: false,
	});

	beforeEach(() => {
		vi.useFakeTimers();

		// 1. `retry` is auto-mocked with the rest of utils; the real one runs here, since its pacing is what is tested
		vi.mocked(retry).mockImplementation(retryActual);

		// 2. A fixed part size, so the context's size means exactly three parts
		driver['calcOptimalPartSize'] = vi.fn().mockReturnValue(chunkSize);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('Completes the upload once the listing shows every part', async () => {
		vi.mocked(driver['client'].send).mockResolvedValue(listing(3) as unknown as void);

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

	test('Polls the listing with growing pauses until every part shows', async () => {
		// 1. Two short listings, then a full one: the completion goes out after 0.5 s + 1 s of waiting
		vi.mocked(driver['client'].send)
			.mockResolvedValueOnce(listing(2) as unknown as void)
			.mockResolvedValueOnce(listing(2) as unknown as void)
			.mockResolvedValue(listing(3) as unknown as void);

		const run = driver.finishChunkedUpload(sample.path.input, context);

		await vi.advanceTimersByTimeAsync(1500);
		await run;

		expect(ListPartsCommand).toHaveBeenCalledTimes(3);
		expect(CompleteMultipartUploadCommand).toHaveBeenCalledTimes(1);
	});

	test('Refuses with the TUS error object when parts are still missing after three retries', async () => {
		// 1. Four short listings — the first attempt and three retries — and nothing is completed
		vi.mocked(driver['client'].send).mockResolvedValue(listing(2) as unknown as void);

		const run = driver.finishChunkedUpload(sample.path.input, context);
		const outcome = run.catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(500 + 1000 + 1500);

		await expect(outcome).resolves.toEqual({ status_code: 500, body: 'Failed to upload all parts to S3.' });
		expect(ListPartsCommand).toHaveBeenCalledTimes(4);
		expect(CompleteMultipartUploadCommand).not.toHaveBeenCalled();
	});

	test('Throws a failing listing at once, without retrying it', async () => {
		// 1. A rejected `ListParts` is a real error, not a listing that lags: it goes out as it is after one call
		const failure = new Error('connection reset');

		vi.mocked(driver['client'].send).mockRejectedValue(failure);

		await expect(driver.finishChunkedUpload(sample.path.input, context)).rejects.toBe(failure);
		expect(ListPartsCommand).toHaveBeenCalledTimes(1);
		expect(CompleteMultipartUploadCommand).not.toHaveBeenCalled();
	});
});
