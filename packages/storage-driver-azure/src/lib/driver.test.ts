/**
 * Tests of `storage-driver-azure/lib/driver`.
 */
import { PassThrough } from 'node:stream';
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
import { joinPath, normalizePath } from '@novastarter/utils';
import { isReadableStream } from '@novastarter/utils/node';
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { StorageDriverAzure, type StorageDriverAzureConfig } from './driver.js';

vi.mock('@novastarter/utils/node');
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

	test('Creates signed credentials', () => {
		expect(StorageSharedKeyCredential).toHaveBeenCalledWith(sample.config.accountName, sample.config.accountKey);
		expect(driver['signedCredentials']).toBeInstanceOf(StorageSharedKeyCredential);
	});

	test('Creates blob service client and sets containerClient', () => {
		const mockSignedCredentials = {} as StorageSharedKeyCredential;
		vi.mocked(StorageSharedKeyCredential).mockReturnValueOnce(mockSignedCredentials);

		const mockContainerClient = {} as ContainerClient;

		const mockBlobServiceClient = {
			getContainerClient: vi.fn().mockReturnValue(mockContainerClient),
		} as unknown as BlobServiceClient;

		vi.mocked(BlobServiceClient).mockReturnValue(mockBlobServiceClient);

		const driver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
		});

		expect(BlobServiceClient).toHaveBeenCalledWith(
			`https://${sample.config.accountName}.blob.core.windows.net`,
			mockSignedCredentials,
		);

		expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith(sample.config.containerName);
		expect(driver['containerClient']).toBe(mockContainerClient);
	});

	describe('Allows overriding endpoint with optional setting', () => {
		test('Creates blob service client and sets containerClient', () => {
			const mockSignedCredentials = {} as StorageSharedKeyCredential;
			vi.mocked(StorageSharedKeyCredential).mockReturnValueOnce(mockSignedCredentials);

			const mockContainerClient = {} as ContainerClient;

			const mockBlobServiceClient = {
				getContainerClient: vi.fn().mockReturnValue(mockContainerClient),
			} as unknown as BlobServiceClient;

			vi.mocked(BlobServiceClient).mockReturnValue(mockBlobServiceClient);

			const driver = new StorageDriverAzure({
				containerName: sample.config.containerName,
				accountName: sample.config.accountName,
				accountKey: sample.config.accountKey,
				endpoint: sample.config.endpoint,
			});

			expect(BlobServiceClient).toHaveBeenCalledWith(sample.config.endpoint, mockSignedCredentials);

			expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith(sample.config.containerName);
			expect(driver['containerClient']).toBe(mockContainerClient);
		});
	});

	test('Defaults root path to empty string', () => {
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);

		new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
			root: sample.path.input,
		});

		expect(normalizePath).toHaveBeenCalledWith(sample.path.input, { removeLeading: true });
	});
});

describe('#fullPath', () => {
	test('Returns the joined path', () => {
		// 1. `joinPath` is auto-mocked; a fixed return value lets the assertions check the wiring, not real path logic
		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);

		const driver = new StorageDriverAzure({
			containerName: sample.config.containerName,
			accountName: sample.config.accountName,
			accountKey: sample.config.accountKey,
		});

		driver['root'] = sample.config.root;

		// 2. `joinPath` must get root and path in that order, and its result is the blob name
		const result = driver['fullPath'](sample.path.input);

		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#read', () => {
	let mockDownload: Mock;

	beforeEach(async () => {
		mockDownload = vi.fn().mockResolvedValue({ readableStreamBody: sample.stream });

		const mockBlobClient = vi.fn().mockReturnValue({
			download: mockDownload,
		});

		driver['containerClient'] = {
			getBlobClient: mockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls download with undefined undefined when no range is passed', async () => {
		await driver.read(sample.path.input);

		expect(mockDownload).toHaveBeenCalledWith(undefined, undefined);
	});

	test('Calls download with offset if start range is provided', async () => {
		await driver.read(sample.path.input, { range: { start: sample.range.start } });

		expect(mockDownload).toHaveBeenCalledWith(sample.range.start, undefined);
	});

	test('Calls download with count if end range is provided', async () => {
		await driver.read(sample.path.input, { range: { end: sample.range.end } });

		expect(mockDownload).toHaveBeenCalledWith(undefined, sample.range.end + 1);
	});

	test('Calls download with offset and count if start and end ranges are provided', async () => {
		await driver.read(sample.path.input, { range: sample.range });

		expect(mockDownload).toHaveBeenCalledWith(sample.range.start, sample.range.end - sample.range.start + 1);
	});

	test('Throws error when no readable stream is returned', async () => {
		mockDownload.mockResolvedValue({ readableStreamBody: undefined });

		try {
			await driver.read(sample.path.input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});
});

describe('#write', () => {
	let mockUploadStream: Mock;
	let mockBlockBlobClient: Mock;

	beforeEach(() => {
		mockUploadStream = vi.fn();

		mockBlockBlobClient = vi.fn().mockReturnValue({
			uploadStream: mockUploadStream,
		});

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;

		vi.mocked(isReadableStream).mockReturnValue(true);
	});

	test('Gets BlockBlobClient for file path', async () => {
		await driver.write(sample.path.input, sample.stream);

		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Uploads stream through uploadStream', async () => {
		await driver.write(sample.path.input, sample.stream);

		expect(mockUploadStream).toHaveBeenCalledWith(sample.stream, undefined, undefined, {
			blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
		});
	});

	test('Allows optional mime type to be set', async () => {
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		expect(mockUploadStream).toHaveBeenCalledWith(sample.stream, undefined, undefined, {
			blobHTTPHeaders: { blobContentType: sample.file.type },
		});
	});
});

describe('#delete', () => {
	let mockDeleteIfExists: Mock;

	beforeEach(() => {
		mockDeleteIfExists = vi.fn().mockResolvedValue(true);

		const mockBlockBlobClient = vi.fn().mockReturnValue({
			deleteIfExists: mockDeleteIfExists,
		});

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		await driver.delete(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns delete result', async () => {
		await driver.delete(sample.path.input);

		expect(mockDeleteIfExists).toHaveBeenCalled();
	});
});

describe('#stat', () => {
	beforeEach(() => {
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
		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns contentLength/lastModified as size/modified from getProperties', async () => {
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
});

describe('#exists', () => {
	let mockExists: Mock;

	beforeEach(() => {
		mockExists = vi.fn().mockResolvedValue(true);

		const mockBlockBlobClient = vi.fn().mockReturnValue({
			exists: mockExists,
		});

		driver['containerClient'] = {
			getBlockBlobClient: mockBlockBlobClient,
		} as unknown as ContainerClient;
	});

	test('Uses blobClient at full path', async () => {
		await driver.exists(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['containerClient'].getBlockBlobClient).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns exists result', async () => {
		const result = await driver.exists(sample.path.input);

		expect(mockExists).toHaveBeenCalled();
		expect(result).toBe(true);
	});

	/**
	 * The SDK only answers false for a missing blob, so a failed lookup has to keep travelling. Reporting
	 * it as a missing file makes callers act on a wrong answer.
	 */
	test('Throws if the lookup failed', async () => {
		const error = new Error('Service unavailable');
		mockExists.mockRejectedValue(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#move', () => {
	let mockDeleteIfExists: Mock;
	let mockBlockBlobClient: Mock;

	beforeEach(() => {
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
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver.copy).toHaveBeenCalledWith(sample.path.src, sample.path.dest);
	});

	test('Deletes src file after copy is completed', async () => {
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
		mockPollUntilDone = vi.fn();

		mockBeginCopyFromUrl = vi.fn().mockResolvedValue({
			pollUntilDone: mockPollUntilDone,
		});

		mockUrl = randUrl();

		// 1. The first client is the source (only its `url` is read), the second is the target the copy is started on
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
		await driver.copy(sample.path.src, sample.path.dest);

		expect(driver['fullPath']).toHaveBeenCalledTimes(2);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);

		expect(mockBlockBlobClient).toHaveBeenCalledTimes(2);
		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.srcFull);
		expect(mockBlockBlobClient).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Calls beginCopyFromUrl with source url', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		expect(mockBeginCopyFromUrl).toHaveBeenCalledOnce();
		expect(mockBeginCopyFromUrl).toHaveBeenCalledWith(mockUrl);
	});

	test('Waits for the polling to be done', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		expect(mockPollUntilDone).toHaveBeenCalledOnce();
	});
});

describe('#list', () => {
	let mockListBlobsFlat: Mock;

	beforeEach(() => {
		mockListBlobsFlat = vi.fn().mockReturnValue([]);

		driver['containerClient'] = {
			listBlobsFlat: mockListBlobsFlat,
		} as unknown as ContainerClient;
	});

	test('Uses listBlobsFlat at default empty path', async () => {
		await driver.list().next();

		expect(driver['fullPath']).toHaveBeenCalledWith('');

		expect(mockListBlobsFlat).toHaveBeenCalledWith({
			prefix: '',
		});
	});

	test('Allows for optional prefix', async () => {
		await driver.list(sample.path.input).next();

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);

		expect(mockListBlobsFlat).toHaveBeenCalledWith({
			prefix: sample.path.inputFull,
		});
	});

	test('Returns blob.name for each returned blob', async () => {
		const mockFile = randFilePath();
		mockListBlobsFlat.mockReturnValue([{ name: mockFile }]);

		const output = [];

		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([mockFile]);
	});
});
