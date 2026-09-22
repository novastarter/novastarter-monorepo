/**
 * Tests of `storage-driver-azure/lib/driver`.
 */
import { PassThrough, Readable } from 'node:stream';
import { BlobServiceClient, type ContainerClient, StorageSharedKeyCredential } from '@azure/storage-blob';
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
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath } from '@novastarter/utils';
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { StorageDriverAzure, type StorageDriverAzureConfig } from './driver.js';

vi.mock('@novastarter/utils');
vi.mock('@azure/storage-blob');

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

	test('Creates blob service client and sets containerClient', () => {
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
		expect(driver['containerClient']).toBe(mockContainerClient);
	});

	describe('Allows overriding endpoint with optional setting', () => {
		test('Creates blob service client and sets containerClient', () => {
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
			expect(driver['containerClient']).toBe(mockContainerClient);
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

		driver['containerClient'] = {
			getBlobClient: mockBlobClient,
		} as unknown as ContainerClient;
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
		expect(driver['containerClient'].getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
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

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
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

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or a delete could remove a blob outside the root
		await driver.delete(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
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

		driver['containerClient'] = {
			getBlobClient: mockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or the metadata would describe a blob outside the root
		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
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

		driver['containerClient'] = {
			getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockRejectedValue(cause) }),
		} as unknown as ContainerClient;

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other SDK error', async () => {
		// 1. A 403 says nothing about whether the blob exists, so it must not be reported as "not found"
		const error = Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });

		driver['containerClient'] = {
			getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockRejectedValue(error) }),
		} as unknown as ContainerClient;

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});

	test('Refuses a properties response missing size or modification time', async () => {
		// 1. Both fields are optional in the SDK's types; answering `undefined` under the non-optional `Stat` type
		//    would fail far from its cause, so a broken response is refused with the path named
		driver['containerClient'] = {
			getBlobClient: vi.fn().mockReturnValue({ getProperties: vi.fn().mockResolvedValue({}) }),
		} as unknown as ContainerClient;

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

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		// 1. The blob name must be the resolved one, or the check would report on a blob outside the root
		await driver.exists(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
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

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;

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

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
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

		driver['containerClient'] = {
			listBlobsFlat: mockListBlobsFlat,
		} as unknown as ContainerClient;
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

		driver['containerClient'] = {
			getAppendBlobClient: vi.fn().mockReturnValue({ appendBlock: mockAppendBlock }),
		} as unknown as ContainerClient;
	});

	test('Appends the buffered chunk at the resolved blob name', async () => {
		const result = await driver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 0, {
			size: sample.file.size,
			metadata: {},
		});

		// 1. The chunk lands as one block under the resolved name, and the offset advances by the bytes appended
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getAppendBlobClient).toHaveBeenCalledWith(sample.path.inputFull);

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
			metadata: {},
		});

		expect(mockAppendBlock).toHaveBeenCalledWith(Buffer.from(sample.text), Buffer.byteLength(sample.text), {
			conditions: { appendPosition: 42 },
		});
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
		tusDriver['containerClient'] = driver['containerClient'];

		await expect(
			tusDriver.writeChunk(sample.path.input, Readable.from([Buffer.from(sample.text)]), 0, {
				size: sample.file.size,
				metadata: {},
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
		tusDriver['containerClient'] = driver['containerClient'];

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
				metadata: {},
			}),
		).rejects.toThrow('exceeds the chunk size limit of 1 bytes');

		// 2. Only the first pull is needed to cross the bound, and the stream is destroyed rather than drained, so the
		//    generator must not keep running past a buffered prefetch
		await new Promise((resolve) => setImmediate(resolve));

		expect(pulls).toBeLessThan(10);

		expect(mockAppendBlock).not.toHaveBeenCalled();
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
	let mockCreateIfNotExists: Mock;

	beforeEach(() => {
		// 1. The append blob is the whole upload state, so creation is one `createIfNotExists` on the resolved name
		mockCreateIfNotExists = vi.fn().mockResolvedValue(undefined);

		driver['containerClient'] = {
			getAppendBlobClient: vi.fn().mockReturnValue({ createIfNotExists: mockCreateIfNotExists }),
		} as unknown as ContainerClient;
	});

	test('Creates an empty append blob under the final name', async () => {
		const context = { size: sample.file.size, metadata: {} };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getAppendBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
		expect(mockCreateIfNotExists).toHaveBeenCalledOnce();
		expect(result).toBe(context);
	});

	test('Keeps blocks already appended when creation is retried', async () => {
		// 1. `createIfNotExists` rather than `create` is what makes a retried creation leave an upload that already has
		//    blocks alone; the assertion above pins the call, here the driver simply must not fail the retry
		mockCreateIfNotExists.mockRejectedValue(Object.assign(new Error('already exists'), { statusCode: 409 }));

		await expect(
			driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toBeDefined();
	});
});

describe('#finishChunkedUpload', () => {
	test('Resolves without a request', async () => {
		// 1. The append blob already holds every chunk under the final name, so there is nothing to assemble
		await expect(
			driver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).resolves.toBeUndefined();
	});
});

describe('#deleteChunkedUpload', () => {
	test('Deletes the append blob under the final name', async () => {
		// 1. Termination is a plain delete of the blob under the final name; `deleteIfExists` keeps a termination for an
		//    upload that never got a chunk from rejecting
		const mockDeleteIfExists = vi.fn().mockResolvedValue(undefined);

		driver['containerClient'] = {
			getBlockBlobClient: vi.fn().mockReturnValue({ deleteIfExists: mockDeleteIfExists }),
		} as unknown as ContainerClient;

		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
		expect(mockDeleteIfExists).toHaveBeenCalledOnce();
	});
});
