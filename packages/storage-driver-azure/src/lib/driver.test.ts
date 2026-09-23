/**
 * Tests of `storage-driver-azure/lib/driver`.
 */
import { PassThrough, Readable } from 'node:stream';
import {
	AccountSASPermissions,
	BlobServiceClient,
	type ContainerClient,
	generateAccountSASQueryParameters,
	type SASQueryParameters,
	StorageSharedKeyCredential,
} from '@azure/storage-blob';
import {
	randAlphaNumeric,
	randGitBranch as randContainer,
	randDirectoryPath,
	randDomainName,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randText,
	randGitShortSha as randUnique,
	randUrl,
	randWord,
} from '@ngneat/falso';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, withTimeout } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { StorageDriverAzure, type StorageDriverAzureConfig } from './driver.js';

vi.mock('@novastarter/utils');
vi.mock('@azure/storage-blob');

const { withTimeout: withTimeoutActual } =
	await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 *
 * The `path.*Full` values are what the stubbed `fullPath` returns for the matching `path.*` input.
 */
let sample: {
	config: { [Key in keyof StorageDriverAzureConfig]-?: NonNullable<StorageDriverAzureConfig[Key]> };
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
let driver: StorageDriverAzure;

/**
 * Metadata key the driver keeps a resumable upload's staging id under.
 */
const STAGING_ID_KEY = 'azure-staging-id';

/**
 * Staging id of the resumable uploads the tests address.
 */
const stagingId = '0123456789ab';

/**
 * Build a resumable-upload context carrying {@link stagingId}.
 *
 * @returns A fresh context for `sample.path.input`.
 */
const stagedContext = () => ({ size: sample.file.size, metadata: { [STAGING_ID_KEY]: stagingId } });

/**
 * Staging blob name the driver derives from `sample.path.input` and {@link stagingId}.
 *
 * @returns The staging blob name inside the container.
 */
const stagingFull = () => `${sample.path.inputFull}.${stagingId}.tmp`;

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			containerName: randContainer(),
			accountName: randWord(),
			accountKey: randAlphaNumeric({ length: 40 }).join(''),
			root: randDirectoryPath(),
			endpoint: `https://${randDomainName()}`,
			tus: { enabled: false },
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

	// 2. The SDK module is mocked above, so constructing the driver only records calls and never opens a socket
	driver = new StorageDriverAzure({
		containerName: sample.config.containerName,
		accountKey: sample.config.accountKey,
		accountName: sample.config.accountName,
	});

	// 3. Stub the private path resolver with a lookup table, so assertions can match exact blob names without
	//    depending on the mocked `joinPath`
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
	test.each([
		['accountName', 'an "accountName"'],
		['accountKey', 'an "accountKey"'],
		['containerName', 'a "containerName"'],
	] as const)('Refuses a missing %s', (option, expected) => {
		// 1. The SDK would only fail on the first request; the driver names the missing option at construction instead
		expect(
			() =>
				new StorageDriverAzure({
					containerName: sample.config.containerName,
					accountKey: sample.config.accountKey,
					accountName: sample.config.accountName,
					[option]: '',
				}),
		).toThrowError(`The azure storage driver needs ${expected}`);
	});

	test('Refuses a chunk size above the append-block limit when resumable uploads are on', () => {
		// 1. Azure rejects appended blocks above 100 MiB, so a larger chunk would only fail mid-upload
		expect(
			() =>
				new StorageDriverAzure({
					containerName: sample.config.containerName,
					accountKey: sample.config.accountKey,
					accountName: sample.config.accountName,
					tus: { enabled: true, chunkSize: 104_857_601 },
				}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: The azure storage driver got a "tus.chunkSize" above 100 MiB]`);
	});

	test.each([[-1], [0], [Number.NaN]])(
		'Refuses a non-positive chunk size of %s when resumable uploads are on',
		(chunkSize) => {
			// 1. A zero, negative or NaN size would be kept as the per-chunk bound and make every arriving chunk fail;
			//    NaN slips through every comparison, which is why the check is written as `!(size > 0)`
			expect(
				() =>
					new StorageDriverAzure({
						containerName: sample.config.containerName,
						accountKey: sample.config.accountKey,
						accountName: sample.config.accountName,
						tus: { enabled: true, chunkSize },
					}),
			).toThrowError('The azure storage driver got a "tus.chunkSize" below 1 byte');
		},
	);

	test('Creates signed credentials', () => {
		// 1. The shared driver from `beforeEach` already ran the constructor, so the credential call is recorded; the
		//    instance check shows the credential is kept for the SDK rather than rebuilt per request
		expect(StorageSharedKeyCredential).toHaveBeenCalledWith(sample.config.accountName, sample.config.accountKey);
		expect(driver['signedCredentials']).toBeInstanceOf(StorageSharedKeyCredential);
	});

	test('Creates blob service client and sets the client', () => {
		// 1. Hand the SDK fixed instances, so the assertions can follow the wiring by identity instead of by shape
		const mockSignedCredentials = {} as StorageSharedKeyCredential;
		vi.mocked(StorageSharedKeyCredential).mockReturnValueOnce(mockSignedCredentials);

		const mockContainerClient = {} as ContainerClient;

		const mockBlobServiceClient = {
			getContainerClient: vi.fn().mockReturnValue(mockContainerClient),
		} as unknown as BlobServiceClient;

		vi.mocked(BlobServiceClient).mockReturnValue(mockBlobServiceClient);

		// 2. Without an endpoint the driver must derive the public one from the account name and sign it with the
		//    credential built a step earlier
		const driver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
		});

		expect(BlobServiceClient).toHaveBeenCalledWith(
			`https://${sample.config.accountName}.blob.core.windows.net`,
			mockSignedCredentials,
		);

		// 3. The container handle has to come from that same service client, or requests would go to another account
		expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith(sample.config.containerName);
		expect(driver.client).toBe(mockContainerClient);
	});

	describe('Allows overriding endpoint with optional setting', () => {
		test('Creates blob service client and sets the client', () => {
			// 1. Hand the SDK fixed instances, so the assertions can follow the wiring by identity instead of by shape
			const mockSignedCredentials = {} as StorageSharedKeyCredential;
			vi.mocked(StorageSharedKeyCredential).mockReturnValueOnce(mockSignedCredentials);

			const mockContainerClient = {} as ContainerClient;

			const mockBlobServiceClient = {
				getContainerClient: vi.fn().mockReturnValue(mockContainerClient),
			} as unknown as BlobServiceClient;

			vi.mocked(BlobServiceClient).mockReturnValue(mockBlobServiceClient);

			// 2. A custom endpoint must reach the SDK verbatim, or emulators and sovereign clouds would still be routed
			//    to `blob.core.windows.net`
			const driver = new StorageDriverAzure({
				containerName: sample.config.containerName,
				accountName: sample.config.accountName,
				accountKey: sample.config.accountKey,
				endpoint: sample.config.endpoint,
			});

			expect(BlobServiceClient).toHaveBeenCalledWith(sample.config.endpoint, mockSignedCredentials);

			// 3. The container handle has to come from that same service client, or requests would go to another host
			expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith(sample.config.containerName);
			expect(driver.client).toBe(mockContainerClient);
		});
	});

	test('Defaults root path to empty string', () => {
		// 1. The shared driver was built without a root; an empty string rather than `undefined` keeps `joinPath` from
		//    producing blob names that start with "undefined/"
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		// 1. `confinePath` is auto-mocked, so the call alone shows the root goes through the same resolution as every
		//    key: a leading slash or `..` in the root would otherwise end up inside the blob names
		new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
			root: sample.path.input,
		});

		expect(confinePath).toHaveBeenCalledWith(sample.path.input);
	});
});

describe('#fullPath', () => {
	test('Returns the joined path', () => {
		// 1. `joinPath` is auto-mocked; a fixed return value lets the assertions check the wiring, not real path logic
		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(confinePath).mockReturnValue(sample.path.input);

		const driver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
		});

		driver['root'] = sample.config.root;

		// 2. `joinPath` must get root and path in that order, and its result is the blob name
		const result = driver['fullPath'](sample.path.input);

		// 3. The caller path is confined first, so a leading `..` is dropped before the root is joined
		expect(confinePath).toHaveBeenCalledWith(sample.path.input);
		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#read', () => {
	let mockDownload: Mock;

	beforeEach(async () => {
		// 1. Resolve a stream by default, so the range tests only have to assert on the arguments handed to the SDK
		mockDownload = vi.fn().mockResolvedValue({ readableStreamBody: sample.stream });

		const mockBlobClient = vi.fn().mockReturnValue({
			download: mockDownload,
		});

		Object.assign(driver, {
			client: {
				getBlobClient: mockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Throws StorageFileNotFoundError when the blob is missing, rethrows anything else', async () => {
		// 1. A 404 is the error every backend shares, so callers can tell a missing blob from any other failure
		mockDownload.mockRejectedValueOnce(Object.assign(new Error('BlobNotFound'), { statusCode: 404 }));
		await expect(driver.read(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);

		// 2. A denied read says nothing about the blob, so it must keep its own identity instead of becoming "not found"
		const denied = Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });
		mockDownload.mockRejectedValueOnce(denied);
		await expect(driver.read(sample.path.input)).rejects.toBe(denied);
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, not the caller path, or the root prefix would be lost
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls download with undefined undefined when no range is passed', async () => {
		// 1. Without a range the SDK gets neither offset nor count, which is how it reads the whole blob
		await driver.read(sample.path.input);

		expect(mockDownload).toHaveBeenCalledWith(undefined, undefined);
	});

	test('Calls download with offset if start range is provided', async () => {
		// 1. A start alone becomes the offset; the count stays undefined so the rest of the blob is read
		await driver.read(sample.path.input, { range: { start: sample.range.start } });

		expect(mockDownload).toHaveBeenCalledWith(sample.range.start, undefined);
	});

	test('Calls download with count if end range is provided', async () => {
		// 1. An end alone counts from byte zero; the bound is inclusive, hence one more than the end
		await driver.read(sample.path.input, { range: { end: sample.range.end } });

		expect(mockDownload).toHaveBeenCalledWith(undefined, sample.range.end + 1);
	});

	test('Calls download with offset and count if start and end ranges are provided', async () => {
		// 1. The SDK takes offset and count, so the closed range has to be converted rather than passed through
		await driver.read(sample.path.input, { range: sample.range });

		expect(mockDownload).toHaveBeenCalledWith(sample.range.start, sample.range.end - sample.range.start + 1);
	});

	test('Turns a zero end into a count of one, the first byte', async () => {
		// 1. `end: 0` is a bound like any other; dropped by a truthiness check it would download the whole blob
		await driver.read(sample.path.input, { range: { start: 0, end: 0 } });

		expect(mockDownload).toHaveBeenCalledWith(0, 1);
	});

	test('Throws error when no readable stream is returned', async () => {
		// 1. `readableStreamBody` is only set in Node; without it there is nothing to hand back, and a silent
		//    `undefined` would crash the caller further away from the cause
		mockDownload.mockResolvedValue({ readableStreamBody: undefined });

		await expect(driver.read(sample.path.input)).rejects.toThrowError(
			`No stream returned for file "${sample.path.input}"`,
		);
	});
});

describe('#write', () => {
	let mockUploadStream: Mock;
	let mockBlockBlobClient: Mock;

	beforeEach(() => {
		// 1. Record the upload call only; the mocked SDK never consumes the stream, so no data has to be written to it
		mockUploadStream = vi.fn();

		mockBlockBlobClient = vi.fn().mockReturnValue({
			uploadStream: mockUploadStream,
		});

		Object.assign(driver, {
			client: {
				getBlockBlobClient: mockBlockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Gets BlockBlobClient for file path', async () => {
		// 1. The block blob must be addressed by the resolved name, or the write lands outside the root
		await driver.write(sample.path.input, sample.stream);

		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Uploads stream through uploadStream', async () => {
		// 1. Buffer size and concurrency stay at the SDK defaults; the only header set is a generic content type, so
		//    the blob is never served without one
		await driver.write(sample.path.input, sample.stream);

		expect(mockUploadStream).toHaveBeenCalledWith(sample.stream, undefined, undefined, {
			blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
		});
	});

	test('Allows optional mime type to be set', async () => {
		// 1. A caller-supplied type has to reach the blob's `Content-Type`, since that is what the service serves it with
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		expect(mockUploadStream).toHaveBeenCalledWith(sample.stream, undefined, undefined, {
			blobHTTPHeaders: { blobContentType: sample.file.type },
		});
	});
});

describe('#delete', () => {
	let mockDeleteIfExists: Mock;

	beforeEach(() => {
		// 1. Resolve `true` as the SDK does for a blob that was present; the driver ignores the flag either way
		mockDeleteIfExists = vi.fn().mockResolvedValue(true);

		const mockBlockBlobClient = vi.fn().mockReturnValue({
			deleteIfExists: mockDeleteIfExists,
		});

		Object.assign(driver, {
			client: {
				getBlockBlobClient: mockBlockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or a delete could remove a blob outside the root
		await driver.delete(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns delete result', async () => {
		// 1. `deleteIfExists` rather than `delete`, so removing a blob that is already gone is a no-op, not a 404
		await driver.delete(sample.path.input);

		expect(mockDeleteIfExists).toHaveBeenCalled();
	});
});

describe('#stat', () => {
	beforeEach(() => {
		// 1. Answer the HEAD request with the fixture's size and date, so the mapping test has known values to compare
		const mockGetProperties = vi.fn().mockReturnValue({
			contentLength: sample.file.size,
			lastModified: sample.file.modified,
		});

		const mockBlobClient = vi.fn().mockReturnValue({
			getProperties: mockGetProperties,
		});

		Object.assign(driver, {
			client: {
				getBlobClient: mockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or the metadata would describe a blob outside the root
		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns contentLength/lastModified as size/modified from getProperties', async () => {
		// 1. Only the two fields every backend shares are returned, under the names the `Stat` contract uses
		const result = await driver.stat(sample.path.input);

		expect(result).toStrictEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});
	});

	test('Maps a 404 to the kit error', async () => {
		// 1. The SDK's `RestError` carries the HTTP status as `statusCode`; 404 becomes the error every backend shares
		const cause = Object.assign(new Error('BlobNotFound'), { statusCode: 404 });

		Object.assign(driver, {
			client: {
				getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockRejectedValue(cause) }),
			} as unknown as ContainerClient,
		});

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other SDK error', async () => {
		// 1. A 403 says nothing about whether the blob exists, so it must not be reported as "not found"
		const error = Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });

		Object.assign(driver, {
			client: {
				getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockRejectedValue(error) }),
			} as unknown as ContainerClient,
		});

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});

	test('Refuses a properties response missing size or modification time', async () => {
		// 1. Both fields are optional in the SDK's types; answering `undefined` under the non-optional `Stat` type
		//    would fail far from its cause, so a broken response is refused with the path named
		Object.assign(driver, {
			client: {
				getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockResolvedValue({}) }),
			} as unknown as ContainerClient,
		});

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}"`,
		);
	});
});

describe('#exists', () => {
	let mockExists: Mock;

	beforeEach(() => {
		// 1. Answer `true` by default, so the pass-through test can tell the SDK's answer from a hard-coded one
		mockExists = vi.fn().mockResolvedValue(true);

		const mockBlockBlobClient = vi.fn().mockReturnValue({
			exists: mockExists,
		});

		Object.assign(driver, {
			client: {
				getBlockBlobClient: mockBlockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or the check would report on a blob outside the root
		await driver.exists(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns exists result', async () => {
		// 1. The SDK already does the HEAD request and the 404 check, so its answer is returned untouched
		const result = await driver.exists(sample.path.input);

		expect(mockExists).toHaveBeenCalled();
		expect(result).toBe(true);
	});

	test('Throws if the lookup failed', async () => {
		// 1. The SDK only answers `false` for a missing blob, so a failed lookup has to keep travelling; reporting it as
		//    a missing file would make callers act on a wrong answer
		const error = new Error('Service unavailable');
		mockExists.mockRejectedValue(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#move', () => {
	let mockDeleteIfExists: Mock;
	let mockBlockBlobClient: Mock;

	beforeEach(() => {
		// 1. Only the delete step runs against the SDK here; `copy` is stubbed so the move is checked in isolation
		mockDeleteIfExists = vi.fn();

		mockBlockBlobClient = vi.fn().mockReturnValue({
			deleteIfExists: mockDeleteIfExists,
		});

		Object.assign(driver, {
			client: {
				getBlockBlobClient: mockBlockBlobClient,
			} as unknown as ContainerClient,
		});

		driver.copy = vi.fn();
	});

	test('Calls #copy with src and dest', async () => {
		// 1. Blob Storage has no rename, so the move must reuse the server-side copy with the caller's paths
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver.copy).toHaveBeenCalledWith(sample.path.src, sample.path.dest);
	});

	test('Deletes src file after copy is completed', async () => {
		// 1. The source is removed by its resolved name and exactly once; a second delete would be a wasted request
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.srcFull);
		expect(mockDeleteIfExists).toHaveBeenCalledOnce();
	});
});

describe('#copy', () => {
	let mockPollUntilDone: Mock;
	let mockBeginCopyFromUrl: Mock;
	let mockBlockBlobClient: Mock;
	let mockUrl: string;

	beforeEach(() => {
		// 1. The poller resolves at once, so `copy` returns without the test having to drive a pending server-side copy
		mockPollUntilDone = vi.fn();

		mockBeginCopyFromUrl = vi.fn().mockResolvedValue({
			pollUntilDone: mockPollUntilDone,
		});

		mockUrl = randUrl();

		// 2. The first client is the source (only its `url` is read), the second is the target the copy is started on
		mockBlockBlobClient = vi
			.fn()
			.mockReturnValueOnce({
				url: mockUrl,
			})
			.mockReturnValueOnce({
				beginCopyFromURL: mockBeginCopyFromUrl,
			});

		Object.assign(driver, {
			client: {
				getBlockBlobClient: mockBlockBlobClient,
			} as unknown as ContainerClient,
		});
	});

	test('Gets BlockBlobClient for src and dest', async () => {
		// 1. Both names are resolved, so neither end of the copy can escape the root
		await driver.copy(sample.path.src, sample.path.dest);

		expect(driver['fullPath']).toHaveBeenCalledTimes(2);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);

		expect(mockBlockBlobClient).toHaveBeenCalledTimes(2);
		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.srcFull);
		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Calls beginCopyFromUrl with source url', async () => {
		// 1. The copy is started on the target from the source's URL, which is the only way the service copies blobs
		await driver.copy(sample.path.src, sample.path.dest);

		expect(mockBeginCopyFromUrl).toHaveBeenCalledOnce();
		expect(mockBeginCopyFromUrl).toHaveBeenCalledWith(mockUrl);
	});

	test('Waits for the polling to be done', async () => {
		// 1. The copy runs asynchronously on the server, so returning before the poller finishes would let a `move`
		//    delete the source while the copy is still pending
		await driver.copy(sample.path.src, sample.path.dest);

		expect(mockPollUntilDone).toHaveBeenCalledOnce();
	});
});

describe('#list', () => {
	let mockListBlobsFlat: Mock;

	beforeEach(() => {
		// 1. An empty page by default; a plain array stands in for the SDK's paged iterator, since `for await` accepts
		//    either
		mockListBlobsFlat = vi.fn().mockReturnValue([]);

		Object.assign(driver, {
			client: {
				listBlobsFlat: mockListBlobsFlat,
			} as unknown as ContainerClient,
		});
	});

	test('Uses listBlobsFlat at default empty path', async () => {
		// 1. With no prefix the whole root is listed; the resolver still runs so the root itself becomes the prefix
		await driver.list().next();

		expect(driver['fullPath']).toHaveBeenCalledWith('');

		expect(mockListBlobsFlat).toHaveBeenCalledWith({
			prefix: '',
		});
	});

	test('Allows for optional prefix', async () => {
		// 1. The prefix is resolved like any key, so a listing under `media` cannot spill into a sibling folder
		await driver.list(sample.path.input).next();

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);

		expect(mockListBlobsFlat).toHaveBeenCalledWith({
			prefix: sample.path.inputFull,
		});
	});

	test('Returns blob.name for each returned blob', async () => {
		// 1. With an empty root there is nothing to strip, so the blob name comes back as the relative path unchanged
		const mockFile = randFilePath();
		mockListBlobsFlat.mockReturnValue([{ name: mockFile }]);

		const output = [];

		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([mockFile]);
	});

	test('Skips the staging blobs of resumable uploads in flight', async () => {
		// 1. A `<name>.<id>.tmp` blob holds a partial upload, not an object a caller stored
		const mockFile = randFilePath();
		mockListBlobsFlat.mockReturnValue([{ name: `${mockFile}.0123456789ab.tmp` }, { name: mockFile }]);

		const output = [];

		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([mockFile]);
	});

	test('Skips folder placeholder blobs ending in a slash', async () => {
		// 1. ADLS Gen2 and several upload tools create zero-byte `folder/` markers; a caller that pipes `list()` into
		//    `read()` breaks on them, so they are left out like on the S3 and GCS drivers
		const mockFile = randFilePath();
		mockListBlobsFlat.mockReturnValue([{ name: 'folder/' }, { name: mockFile }]);

		const output = [];

		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([mockFile]);
	});
});

describe('#writeChunk', () => {
	let mockAppendBlock: Mock;

	beforeEach(() => {
		// 1. The append call is recorded, so the chunk the driver sends can be asserted without any request
		mockAppendBlock = vi.fn().mockResolvedValue(undefined);

		Object.assign(driver, {
			client: {
				getAppendBlobClient: vi.fn().mockReturnValue({ appendBlock: mockAppendBlock }),
			} as unknown as ContainerClient,
		});
	});

	test('Appends the buffered chunk to the staging blob, not the target', async () => {
		const result = await driver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 0, {
			size: sample.file.size,
			metadata: { [STAGING_ID_KEY]: stagingId },
		});

		// 1. The chunk lands as one block in the staging blob, and the offset advances by the bytes appended
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getAppendBlobClient).toHaveBeenCalledOnce();
		expect(driver.client.getAppendBlobClient).toHaveBeenCalledWith(stagingFull());

		expect(mockAppendBlock).toHaveBeenCalledWith(Buffer.from(sample.text), Buffer.byteLength(sample.text), {
			conditions: { appendPosition: 0 },
		});

		expect(result).toBe(Buffer.byteLength(sample.text));
	});

	test('Pins the append to the offset the chunk starts at', async () => {
		// 1. Append blobs append at the current end unconditionally; pinning the position makes a resent chunk fail
		//    with 412 instead of appending its bytes a second time and corrupting the upload
		await driver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 42, {
			size: sample.file.size,
			metadata: { [STAGING_ID_KEY]: stagingId },
		});

		expect(mockAppendBlock).toHaveBeenCalledWith(Buffer.from(sample.text), Buffer.byteLength(sample.text), {
			conditions: { appendPosition: 42 },
		});
	});

	test('Refuses a context without a valid staging id before any request', async () => {
		// 1. A context that lost its id, or carries a crafted one, must not address the target or another blob
		for (const metadata of [{}, { [STAGING_ID_KEY]: '../x' }]) {
			await expect(
				driver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 0, {
					size: sample.file.size,
					metadata,
				}),
			).rejects.toBeInstanceOf(StorageFileNotFoundError);
		}

		expect(mockAppendBlock).not.toHaveBeenCalled();
	});

	test('Refuses a chunk above the configured size', async () => {
		// 1. The TUS server agreed to send at most the configured size per request; a larger chunk is refused before
		//    the service would reject the append mid-upload
		const tusDriver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountKey: sample.config.accountKey,
			accountName: sample.config.accountName,
			tus: { enabled: true, chunkSize: 1 },
		});

		tusDriver['fullPath'] = driver['fullPath'];
		Object.assign(tusDriver, { client: driver.client });

		await expect(
			tusDriver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 0, {
				size: sample.file.size,
				metadata: { [STAGING_ID_KEY]: stagingId },
			}),
		).rejects.toThrow(`The chunk of ${Buffer.byteLength(sample.text)} bytes exceeds the chunk size limit of 1 bytes`);

		expect(mockAppendBlock).not.toHaveBeenCalled();
	});

	test('Stops consuming the stream once the chunk crosses the configured size', async () => {
		// 1. The bound is enforced while the chunk is still arriving, so a chunk that never ends must be refused rather
		//    than buffered forever
		const tusDriver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountKey: sample.config.accountKey,
			accountName: sample.config.accountName,
			tus: { enabled: true, chunkSize: 1 },
		});

		tusDriver['fullPath'] = driver['fullPath'];
		Object.assign(tusDriver, { client: driver.client });

		let pulls = 0;

		const endless = Readable.from(
			(async function* () {
				while (true) {
					pulls += 1;
					yield Buffer.from(sample.text);
				}
			})(),
		);

		await expect(
			tusDriver.writeChunk(sample.path.input, endless, 0, {
				size: sample.file.size,
				metadata: { [STAGING_ID_KEY]: stagingId },
			}),
		).rejects.toThrow('exceeds the chunk size limit of 1 bytes');

		// 2. Only the first pull is needed to cross the bound, and the stream is destroyed rather than drained, so the
		//    generator must not keep running past a buffered prefetch
		await new Promise((resolve) => setImmediate(resolve));

		expect(pulls).toBeLessThan(10);

		expect(mockAppendBlock).not.toHaveBeenCalled();
	});
});

describe('#call', () => {
	/**
	 * The SAS signature the mocked SDK signs with; it must never reach an error.
	 */
	const signature = 'c2VjcmV0+c2ln/bmF0dXJl=';

	let fetchMock: Mock;

	beforeEach(() => {
		// 1. The real deadline, a SAS of known content, and a `fetch` that records the request
		vi.mocked(withTimeout).mockImplementation(withTimeoutActual);

		vi.mocked(generateAccountSASQueryParameters).mockReturnValue({
			version: '2026-06-06',
			signature,
			toString: () => `sv=2026-06-06&sig=${encodeURIComponent(signature)}`,
		} as unknown as SASQueryParameters);

		fetchMock = vi.fn().mockResolvedValue(new Response('<xml/>', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		driver = new StorageDriverAzure({
			containerName: 'media',
			accountKey: sample.config.accountKey,
			accountName: 'acct',
		});
	});

	afterEach(() => {
		// 1. The global `fetch` is the real one again for the other tests
		vi.unstubAllGlobals();
	});

	test('Requests the account endpoint with the parameters and the SAS in the query', async () => {
		// 1. `{container}` becomes the container; the SAS rides in the query, the API version in a header
		const result = await driver.call('GET /{container}?restype=container', { comp: 'metadata' });

		const [href, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const url = new URL(href);

		expect(url.origin + url.pathname).toBe('https://acct.blob.core.windows.net/media');
		expect(url.searchParams.get('restype')).toBe('container');
		expect(url.searchParams.get('comp')).toBe('metadata');
		expect(url.searchParams.get('sig')).toBe(signature);
		expect(init).toMatchObject({ method: 'GET', headers: { 'x-ms-version': '2026-06-06' } });
		expect(init.body).toBeUndefined();
		expect(result.data).toBe('<xml/>');
	});

	test('Fills a placeholder from the parameters, encoded, and does not send that parameter again', async () => {
		// 1. `{blob}` takes the `blob` parameter; `/` in it cannot reshape the path, and it is not in the query
		await driver.call('GET /{container}/{blob}', { blob: 'media/a b.jpg', comp: 'tags' });

		const url = new URL((fetchMock.mock.calls[0] as [string])[0]);

		expect(url.pathname).toBe('/media/media%2Fa%20b.jpg');
		expect(url.searchParams.get('comp')).toBe('tags');
		expect(url.searchParams.has('blob')).toBe(false);
	});

	test('Refuses a placeholder nobody filled before anything is sent', async () => {
		// 1. Sent, `{blob}` would reach Azure as `%7Bblob%7D`
		await expect(driver.call('GET /{container}/{blob}')).rejects.toThrow('needs a "blob" parameter');

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers with the status, the headers lower-cased and the body', async () => {
		// 1. A HEAD's properties arrive in headers only
		fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { 'X-Ms-Blob-Type': 'BlockBlob' } }));

		const result = await driver.call('HEAD /{container}/a.jpg');

		expect(result).toEqual({ status: 200, headers: { 'x-ms-blob-type': 'BlockBlob' }, data: undefined });
	});

	test('Signs a short-lived blob SAS with the account credential', async () => {
		// 1. Blob service only, the resource types `call()` addresses, a lifetime of minutes — and read, delete, list
		//    and tag only, never write or create, so a SAS that leaks cannot change anything in the account
		await driver.call('GET /', { restype: 'service', comp: 'properties' });

		expect(AccountSASPermissions.parse).toHaveBeenCalledWith('rdlt');

		expect(generateAccountSASQueryParameters).toHaveBeenCalledWith(
			expect.objectContaining({ services: 'b', resourceTypes: 'sco', protocol: 'https' }),
			driver['signedCredentials'],
		);

		const [values] = vi.mocked(generateAccountSASQueryParameters).mock.calls[0]!;

		expect(values.expiresOn.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
	});

	test.each(['PUT /', 'POST /{container}', 'PATCH /'])(
		'Refuses the write %j before anything is signed or sent',
		async (method) => {
			// 1. A write's body is the SDK's job; the caller is pointed at the client
			await expect(driver.call(method)).rejects.toThrow('writes go through the client');

			expect(generateAccountSASQueryParameters).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	test('Sends the headers of the caller over its own', async () => {
		// 1. The caller's headers go on top of the API version
		await driver.call('GET /', { comp: 'list' }, { headers: { 'X-Ms-Client-Request-Id': 'abc' } });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

		expect(init.headers).toMatchObject({ 'x-ms-version': '2026-06-06', 'x-ms-client-request-id': 'abc' });
	});

	test('Refuses a full URL on a foreign host before anything is sent', async () => {
		// 1. A SAS for the account must not travel to another party
		await expect(driver.call('GET https://evil.example/')).rejects.toThrow('not on a host of this provider');

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Turns an error status into a ProviderCallError without the SAS or the account key', async () => {
		// 1. Azure quoting the signature in its answer must not put it into the error
		fetchMock.mockResolvedValue(
			new Response(`<Error><Code>AuthenticationFailed</Code><Message>sig=${signature}</Message></Error>`, {
				status: 403,
			}),
		);

		const error = await driver.call('GET /').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toMatchObject({
			provider: 'azure',
			status: 403,
		});

		const everything = JSON.stringify((error as InstanceType<typeof ProviderCallError>).extensions) + String(error);

		expect(everything).toContain('AuthenticationFailed');
		expect(everything).not.toContain(signature);
		expect(everything).not.toContain(encodeURIComponent(signature));
		expect(everything).not.toContain(sample.config.accountKey);
	});

	test('Turns a 429 into a HitRateLimitError', async () => {
		// 1. Azure asking to slow down becomes the kit's rate-limit error
		fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '3' } }));

		await expect(driver.call('GET /')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Gives up at the timeout of the caller', async () => {
		// 1. A request that never answers; the error is matched by shape, since `@novastarter/utils` is mocked here
		fetchMock.mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });
	});

	test('Follows a redirect to another host without the SAS or its headers', async () => {
		// 1. The SAS rides in the first URL only, so the next hop carries neither it nor the API version
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://o.example/x' } }))
			.mockResolvedValueOnce(new Response('<xml/>', { status: 200 }));

		await driver.call('GET /');

		const [href, init] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];

		expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].redirect).toBe('manual');
		expect(href).toBe('https://o.example/x');
		expect(href).not.toContain('sig=');
		expect(init.headers).not.toHaveProperty('x-ms-version');
	});

	test('Reports a failure to reach Azure without its cause, which may quote the signed URL', async () => {
		// 1. A network error naming the URL, SAS included, is replaced by one that names only its code
		fetchMock.mockRejectedValue(
			new TypeError(`fetch failed for ?sig=${encodeURIComponent(signature)}`, {
				cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
			}),
		);

		const error = await driver.call('GET /').catch((thrown: unknown) => thrown);

		expect((error as Error).message).toBe('The azure call could not reach the service (ENOTFOUND)');
		expect((error as Error).cause).toBeUndefined();
		expect(JSON.stringify(error) + String(error)).not.toContain(encodeURIComponent(signature));
	});

	test('Counts the reading of a slow answer against the timeout', async () => {
		// 1. Headers in time, a body that never ends: the deadline still ends the call
		fetchMock.mockImplementation(
			async (_url: string, init: RequestInit) =>
				new Response(
					new ReadableStream({
						start(controller) {
							// 1. The body errors with the abort reason, as a real one does when its request is aborted
							init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
						},
					}),
					{ status: 200 },
				),
		);

		await expect(driver.call('GET /', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });
	});
});

describe('#tusExtensions', () => {
	test('Advertises creation, termination and expiration', () => {
		// 1. Only the extensions the chunked-upload methods back; checksum and concatenation are left out because an
		//    append blob can neither verify a chunk before it lands nor be assembled from several uploads
		expect(driver.tusExtensions).toStrictEqual(['creation', 'termination', 'expiration']);
	});
});

describe('#createChunkedUpload', () => {
	let mockCreate: Mock;

	beforeEach(() => {
		// 1. Creation is one `create` of the staging append blob, recorded so its name can be asserted
		mockCreate = vi.fn().mockResolvedValue(undefined);

		Object.assign(driver, {
			client: {
				getAppendBlobClient: vi.fn().mockReturnValue({ create: mockCreate }),
			} as unknown as ContainerClient,
		});
	});

	test('Creates an empty staging append blob and keeps its id in the context', async () => {
		const context = { size: sample.file.size, metadata: { [STAGING_ID_KEY]: 'client-sent' } };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		// 1. The id is a fresh random one, replacing whatever the client sent under the key
		const id = result.metadata?.[STAGING_ID_KEY];

		expect(id).toMatch(/^[0-9a-f]{12}$/);
		expect(result).toBe(context);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver.client.getAppendBlobClient).toHaveBeenCalledOnce();
		expect(driver.client.getAppendBlobClient).toHaveBeenCalledWith(`${sample.path.inputFull}.${id}.tmp`);
		expect(mockCreate).toHaveBeenCalledOnce();
	});

	test('Leaves a blob already at the path untouched', async () => {
		// 1. Only the staging blob is created, so an existing target keeps its content while the upload runs and after
		//    it is abandoned
		await driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: undefined });

		expect(driver.client.getAppendBlobClient).not.toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gives each upload of the same path its own staging blob', async () => {
		// 1. Two concurrent uploads must never append to one blob
		const first = await driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: undefined });
		const second = await driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: undefined });

		expect(first.metadata?.[STAGING_ID_KEY]).not.toBe(second.metadata?.[STAGING_ID_KEY]);
	});
});

describe('#finishChunkedUpload', () => {
	let mockBeginCopyFromUrl: Mock;
	let mockPollUntilDone: Mock;
	let mockTargetDeleteIfExists: Mock;
	let mockStagingDeleteIfExists: Mock;
	let mockUrl: string;

	beforeEach(() => {
		// 1. The staging blob only has its URL read and is deleted at the end; the copy is started on the target
		mockPollUntilDone = vi.fn().mockResolvedValue(undefined);
		mockBeginCopyFromUrl = vi.fn().mockResolvedValue({ pollUntilDone: mockPollUntilDone });
		mockTargetDeleteIfExists = vi.fn().mockResolvedValue(undefined);
		mockStagingDeleteIfExists = vi.fn().mockResolvedValue(undefined);
		mockUrl = randUrl();

		Object.assign(driver, {
			client: {
				getAppendBlobClient: vi.fn().mockReturnValue({ url: mockUrl, deleteIfExists: mockStagingDeleteIfExists }),
				getBlobClient: vi
					.fn()
					.mockReturnValue({ beginCopyFromURL: mockBeginCopyFromUrl, deleteIfExists: mockTargetDeleteIfExists }),
			} as unknown as ContainerClient,
		});
	});

	test('Copies the staging blob over the target, waits for the copy, then removes the staging blob', async () => {
		// 1. A target of the same type accepts the copy on the first try
		await driver.finishChunkedUpload(sample.path.input, stagedContext());

		// 2. The staging blob is addressed by the id in the context, the target by the plain path
		expect(driver.client.getAppendBlobClient).toHaveBeenCalledWith(stagingFull());
		expect(driver.client.getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);

		// 3. One server-side copy from the staging URL, awaited to completion, and no deletion of the target
		expect(mockBeginCopyFromUrl).toHaveBeenCalledOnce();
		expect(mockBeginCopyFromUrl).toHaveBeenCalledWith(mockUrl);
		expect(mockPollUntilDone).toHaveBeenCalledOnce();
		expect(mockTargetDeleteIfExists).not.toHaveBeenCalled();
		expect(mockStagingDeleteIfExists).toHaveBeenCalledOnce();

		// 4. The staging blob goes only after the copy is done, or the copy would lose its source
		expect(mockPollUntilDone.mock.invocationCallOrder[0]).toBeLessThan(
			mockStagingDeleteIfExists.mock.invocationCallOrder[0] as number,
		);
	});

	test('Removes a target of another blob type and copies again', async () => {
		// 1. Azure copies onto an existing blob only of the source's type; a block blob from `write()` is refused
		mockBeginCopyFromUrl.mockRejectedValueOnce(
			Object.assign(new Error('invalid blob type'), { statusCode: 409, code: 'InvalidBlobType' }),
		);

		await driver.finishChunkedUpload(sample.path.input, stagedContext());

		expect(mockTargetDeleteIfExists).toHaveBeenCalledOnce();
		expect(mockBeginCopyFromUrl).toHaveBeenCalledTimes(2);
		expect(mockStagingDeleteIfExists).toHaveBeenCalledOnce();
	});

	test('Keeps the staging blob and rethrows when the copy after removing the target fails', async () => {
		// 1. The first copy is refused for the blob type, and the second one fails after the target is deleted
		const error = Object.assign(new Error('copy failed'), { statusCode: 500, code: 'InternalError' });

		mockBeginCopyFromUrl
			.mockRejectedValueOnce(
				Object.assign(new Error('invalid blob type'), { statusCode: 409, code: 'InvalidBlobType' }),
			)
			.mockRejectedValueOnce(error);

		await expect(driver.finishChunkedUpload(sample.path.input, stagedContext())).rejects.toBe(error);

		// 2. The old target is gone, but the staging blob survives so a retried finish can still complete the upload
		expect(mockTargetDeleteIfExists).toHaveBeenCalledOnce();
		expect(mockBeginCopyFromUrl).toHaveBeenCalledTimes(2);
		expect(mockStagingDeleteIfExists).not.toHaveBeenCalled();
	});

	test('Rethrows any other conflict without touching the target or the staging blob', async () => {
		// 1. A conflict other than `InvalidBlobType`, such as a copy still pending on the target, is not recoverable here
		const error = Object.assign(new Error('pending copy'), { statusCode: 409, code: 'PendingCopyOperation' });
		mockBeginCopyFromUrl.mockRejectedValueOnce(error);

		await expect(driver.finishChunkedUpload(sample.path.input, stagedContext())).rejects.toBe(error);

		// 2. Neither blob is deleted, so the target is not lost and the finish can be retried
		expect(mockTargetDeleteIfExists).not.toHaveBeenCalled();
		expect(mockStagingDeleteIfExists).not.toHaveBeenCalled();
	});

	test('Throws StorageFileNotFoundError when the staging blob is gone', async () => {
		// 1. A 404 on the copy means the source is missing: the upload is unknown or was already finished
		mockBeginCopyFromUrl.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));

		await expect(driver.finishChunkedUpload(sample.path.input, stagedContext())).rejects.toBeInstanceOf(
			StorageFileNotFoundError,
		);
	});

	test('Throws StorageFileNotFoundError for a context without a staging id', async () => {
		// 1. Without an id there is no staging blob to name, so the driver fails before any request
		await expect(
			driver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toBeInstanceOf(StorageFileNotFoundError);

		expect(mockBeginCopyFromUrl).not.toHaveBeenCalled();
	});
});

describe('#deleteChunkedUpload', () => {
	let mockStagingDeleteIfExists: Mock;
	let mockTargetDeleteIfExists: Mock;

	beforeEach(() => {
		// 1. Both kinds of client are mocked, so a test can prove the target is never deleted
		mockStagingDeleteIfExists = vi.fn().mockResolvedValue(undefined);
		mockTargetDeleteIfExists = vi.fn().mockResolvedValue(undefined);

		Object.assign(driver, {
			client: {
				getAppendBlobClient: vi.fn().mockReturnValue({ deleteIfExists: mockStagingDeleteIfExists }),
				getBlobClient: vi.fn().mockReturnValue({ deleteIfExists: mockTargetDeleteIfExists }),
				getBlockBlobClient: vi.fn().mockReturnValue({ deleteIfExists: mockTargetDeleteIfExists }),
			} as unknown as ContainerClient,
		});
	});

	test('Deletes only the staging blob and leaves the target alone', async () => {
		// 1. An aborted upload never wrote the target, so a file stored there before survives the termination
		await driver.deleteChunkedUpload(sample.path.input, stagedContext());

		expect(driver.client.getAppendBlobClient).toHaveBeenCalledWith(stagingFull());
		expect(mockStagingDeleteIfExists).toHaveBeenCalledOnce();
		expect(mockTargetDeleteIfExists).not.toHaveBeenCalled();
	});

	test('Throws StorageFileNotFoundError for a context without a staging id', async () => {
		// 1. Without an id there is no staging blob to name, and the target must never be deleted in its place
		await expect(
			driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toBeInstanceOf(StorageFileNotFoundError);

		expect(mockStagingDeleteIfExists).not.toHaveBeenCalled();
		expect(mockTargetDeleteIfExists).not.toHaveBeenCalled();
	});
});
