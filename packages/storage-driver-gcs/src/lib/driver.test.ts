/**
 * Tests of `storage-driver-gcs/lib/driver`.
 */
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Bucket, Storage } from '@google-cloud/storage';
import {
	randGitBranch as randBucket,
	randDirectoryPath,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randText,
	randGitShortSha as randUnique,
	randUrl,
} from '@ngneat/falso';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import type { ChunkedUploadContext } from '@novastarter/storage';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, parseCallMethod, withTimeout } from '@novastarter/utils';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverGcsConfig } from './driver.js';
import { StorageDriverGcs } from './driver.js';

vi.mock('@novastarter/utils');
vi.mock('@google-cloud/storage');
vi.mock('node:stream/promises');

const { parseCallMethod: parseCallMethodActual, withTimeout: withTimeoutActual } =
	await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	config: { [Key in keyof StorageDriverGcsConfig]-?: NonNullable<StorageDriverGcsConfig[Key]> };
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
let driver: StorageDriverGcs;

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			root: randDirectoryPath(),
			apiEndpoint: randUrl(),
			bucket: randBucket(),
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

	// 2. `@google-cloud/storage` is mocked above, so constructing the driver only records calls and never opens a socket
	driver = new StorageDriverGcs({
		bucket: sample.config.bucket,
	});

	// 3. Stub the path resolver with a fixed input → output map, so every method test can assert on the resolved name
	//    without depending on `joinPath`, which is mocked and would return `undefined`
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
	test('Refuses a missing bucket', () => {
		// 1. Every operation targets the bucket, so its absence is refused at construction rather than on the first request
		expect(() => new StorageDriverGcs({ bucket: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The gcs storage driver needs a "bucket"]`,
		);
	});

	test('Refuses a chunk size GCS would reject when resumable uploads are on', () => {
		// 1. GCS wants multiples of 256 KiB; a chunk below that or off a power of two would fail on the first PATCH
		expect(
			() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: true, chunkSize: 1000 } }),
		).toThrowErrorMatchingInlineSnapshot(
			`[Error: The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB]`,
		);
	});

	test('Refuses a chunk size GCS would reject even when resumable uploads are off', () => {
		// 1. `writeChunk` hands the size to the SDK regardless of the flag, so a value GCS would reject on the first
		//    PATCH must not pass construction just because `enabled` is false
		expect(
			() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: false, chunkSize: 1000 } }),
		).toThrowErrorMatchingInlineSnapshot(
			`[Error: The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB]`,
		);
	});

	test.each([[0], [Number.NaN]])(
		'Refuses a configured chunk size of %s instead of falling back to the default',
		(chunkSize) => {
			// 1. `||` would read `0` and `NaN` as "not configured" and silently swap in the default before the
			//    validation ran; the configured value itself is what the constructor refuses
			expect(
				() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: true, chunkSize } }),
			).toThrowError('The gcs storage driver got a "tus.chunkSize" that is not a power of two of at least 256 KiB');
		},
	);

	test('Defaults root path to empty string', () => {
		// 1. The shared driver is built without a root; an empty string keeps `joinPath` and `toRelativePath` no-ops
		//    rather than a `'/'` that would end up inside every object name
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		new StorageDriverGcs({
			bucket: sample.config.bucket,
			root: sample.config.root,
		});

		// 1. The root is confined like every key: no leading slash, `.` and `..` resolved
		expect(confinePath).toHaveBeenCalledWith(sample.config.root);
	});

	test('Instantiates Storage object with config options', () => {
		new StorageDriverGcs({
			bucket: sample.config.bucket,
			apiEndpoint: sample.config.apiEndpoint,
		});

		// 1. Only the leftover keys reach the client; `bucket` is the driver's own and must not be forwarded
		expect(Storage).toHaveBeenCalledWith({ apiEndpoint: sample.config.apiEndpoint });
	});

	test('Creates bucket access instance', () => {
		// 1. A hand-made client, so the test can tell which bucket handle the driver keeps
		const mockBucket = {};

		const mockStorage = {
			bucket: vi.fn().mockReturnValue(mockBucket),
		} as unknown as Storage;

		vi.mocked(Storage).mockReturnValue(mockStorage);

		// 2. The handle is opened at construction, so a wrong bucket name fails before any request
		const driver = new StorageDriverGcs({
			bucket: sample.config.bucket,
		});

		expect(mockStorage.bucket).toHaveBeenCalledWith(sample.config.bucket);
		expect(driver['bucket']).toBe(mockBucket);
	});
});

describe('#fullPath', () => {
	beforeEach(() => {
		// 1. A fresh driver with the real `fullPath`, since the shared one is stubbed in the outer `beforeEach`
		driver = new StorageDriverGcs({ bucket: sample.config.bucket });
		driver['root'] = sample.config.root;

		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(confinePath).mockReturnValue(sample.path.input);
	});

	test('Returns the joined path', () => {
		const result = driver['fullPath'](sample.path.input);

		// 1. The caller path is confined first, so a leading `..` is dropped before the root is joined
		expect(confinePath).toHaveBeenCalledWith(sample.path.input);

		// 2. Root and input are joined in that order, and the joined result is the object name
		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#file', () => {
	let mockFile: any;

	beforeEach(() => {
		// 1. A bucket that hands out one known handle, so the test can check the driver returns it untouched
		mockFile = {};

		driver['bucket'] = {
			file: vi.fn().mockReturnValue(mockFile),
		} as unknown as Bucket;
	});

	test('Returns file instance', () => {
		// 1. The handle comes straight from the bucket; nothing is wrapped, so tests can swap the factory freely
		const file = driver['file']('/path/to/file');
		expect(file).toBe(mockFile);
	});
});

describe('#read', () => {
	let mockFile: {
		createReadStream: Mock;
	};

	beforeEach(() => {
		// 1. The handle factory is stubbed, so the test controls the SDK stream the driver pipes through
		mockFile = {
			createReadStream: vi.fn().mockReturnValue(sample.stream),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		// 1. The handle must be asked for the resolved name, not the caller's path
		await driver.read(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Streams the SDK stream through, whole object without a range', async () => {
		const stream = await driver.read(sample.path.input);

		// 1. Without a range the options object stays empty, so the SDK streams the whole object; the SDK's stream is
		//    piped into the one handed out, so its data arrives as is
		expect(mockFile.createReadStream).toHaveBeenCalledOnce();
		expect(mockFile.createReadStream).toHaveBeenCalledWith({});

		const chunks: Buffer[] = [];
		const done = new Promise<void>((resolve) => stream.on('end', resolve));
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));
		sample.stream.end('body');
		await done;
		expect(Buffer.concat(chunks).toString()).toBe('body');
	});

	test('Destroying the handed-out stream destroys the SDK stream too, so a gone client frees the response', async () => {
		// 1. `pipe` would only pause the SDK stream and leave its HTTP response open; `pipeline` tears it down
		const source = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(source);

		const stream = await driver.read(sample.path.input);
		const closed = new Promise<void>((resolve) => source.on('close', () => resolve()));

		stream.destroy();
		await closed;

		expect(source.destroyed).toBe(true);
	});

	test('Turns a 404 of the SDK stream into StorageFileNotFoundError, other errors pass as they are', async () => {
		// 1. The SDK opens the object lazily, so a missing object surfaces on the stream, not on the `read()` call
		const missing = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(missing);

		const stream = await driver.read(sample.path.input);
		const failed = new Promise<unknown>((resolve) => stream.on('error', resolve));
		missing.emit('error', Object.assign(new Error('Not Found'), { code: 404 }));

		expect(await failed).toBeInstanceOf(StorageFileNotFoundError);

		// 2. A 403 says nothing about the object, so it must reach the consumer exactly as the SDK reported it
		const denied = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(denied);

		const other = await driver.read(sample.path.input);
		const otherFailed = new Promise<unknown>((resolve) => other.on('error', resolve));
		const forbidden = Object.assign(new Error('Forbidden'), { code: 403 });
		denied.emit('error', forbidden);

		expect(await otherFailed).toBe(forbidden);
	});

	test('Passes optional range to createReadStream', async () => {
		// 1. Each bound is forwarded on its own, so an open-ended range keeps the other side absent
		await driver.read('/path/to/file', { range: { start: sample.range.start, end: undefined } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: sample.range.start, end: undefined });

		await driver.read('/path/to/file', { range: sample.range });
		expect(mockFile.createReadStream).toHaveBeenCalledWith(sample.range);

		await driver.read('/path/to/file', { range: { start: undefined, end: sample.range.end } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: undefined, end: sample.range.end });

		// 2. `end: 0` is a bound like any other — the first byte — not an absent one
		await driver.read('/path/to/file', { range: { start: 0, end: 0 } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: 0, end: 0 });
	});
});

describe('#write', () => {
	let mockWriteStream: PassThrough;
	let mockCreateWriteStream: Mock;
	let mockSave: Mock;

	let mockFile: {
		createWriteStream: Mock;
		save: Mock;
	};

	beforeEach(() => {
		// 1. The handle factory is stubbed with a recording write stream, so the options the driver opens it with can be
		//    asserted without any request
		mockWriteStream = new PassThrough();

		mockCreateWriteStream = vi.fn().mockReturnValue(mockWriteStream);
		mockSave = vi.fn();

		mockFile = {
			createWriteStream: mockCreateWriteStream,
			save: mockSave,
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference for filepath', async () => {
		// 1. The handle must be asked for the resolved name, not the caller's path
		await driver.write(sample.path.input, sample.stream);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Pipes read stream to write stream in pipeline when stream is passed', async () => {
		await driver.write(sample.path.inputFull, sample.stream);

		// 1. Plain writes are non-resumable single requests; `pipeline` is mocked, so only the wiring is asserted
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ resumable: false });
		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});

	test('Leaves the content type to the SDK when none is given', async () => {
		await driver.write(sample.path.input, sample.stream);

		// 1. No `contentType` key at all, not one set to `undefined`: only an absent key lets the SDK detect the type
		//    from the object name, which is the backend default the other drivers fall back to as well
		expect(mockCreateWriteStream.mock.calls[0]?.[0]).toStrictEqual({ resumable: false });
	});

	test('Records the MIME type when one is given', async () => {
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		// 1. The type maps onto `contentType`, which GCS serves back as the object's Content-Type; without it an image
		//    stored under a `.bin` name would download instead of render, unlike on the other backends
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ resumable: false, contentType: sample.file.type });
		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});
});

describe('#delete', () => {
	let mockFile: {
		delete: Mock;
	};

	beforeEach(() => {
		// 1. The handle factory is stubbed, so the delete call can be asserted without any request
		mockFile = {
			delete: vi.fn(),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		// 1. The handle must be asked for the resolved name, not the caller's path
		await driver.delete(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls delete on file', async () => {
		await driver.delete(sample.path.input);

		// 1. Called without options: no `ignoreNotFound`, so a missing object rejects instead of passing as removed
		expect(mockFile.delete).toHaveBeenCalledOnce();
		expect(mockFile.delete).toHaveBeenCalledWith();
	});
});

describe('#deleteChunkedUpload', () => {
	let mockFile: {
		delete: Mock;
	};

	beforeEach(() => {
		// 1. The handle factory is stubbed, so the termination can be asserted without any request
		mockFile = {
			delete: vi.fn(),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Deletes the object under the final path, ignoring a missing one', async () => {
		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		// 1. The handle must be asked for the resolved name, not the caller's path; an unfinished session has no object
		//    in the bucket, so the SDK's 404 for it must not reject the termination
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
		expect(mockFile.delete).toHaveBeenCalledOnce();
		expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
	});
});

describe('#stat', () => {
	let mockFile: {
		getMetadata: Mock;
	};

	beforeEach(() => {
		// 1. The JSON API reports the size as a string; the driver has to hand out a number
		mockFile = {
			getMetadata: vi.fn().mockResolvedValue([{ size: String(sample.file.size), updated: sample.file.modified }]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		// 1. The handle must be asked for the resolved name, not the caller's path
		await driver.stat(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls getMetadata on file', async () => {
		await driver.stat(sample.path.input);

		// 1. One metadata request without options is all a stat needs; size and time come back in the same answer
		expect(mockFile.getMetadata).toHaveBeenCalledOnce();
		expect(mockFile.getMetadata).toHaveBeenCalledWith();
	});

	test('Returns size/updated as size/modified from metadata response', async () => {
		const result = await driver.stat(sample.path.input);

		// 1. `updated` goes through `new Date(...)`, which returns an equal instant for a `Date` input
		expect(result).toStrictEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});
	});

	test('Maps a 404 to the kit error', async () => {
		// 1. The SDK's `ApiError` carries the HTTP status as `code`; 404 becomes the error every backend shares
		const cause = Object.assign(new Error('No such object'), { code: 404 });
		mockFile.getMetadata.mockRejectedValue(cause);

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other SDK error', async () => {
		// 1. A 403 says nothing about whether the object exists, so it must not be reported as "not found"
		const error = Object.assign(new Error('Forbidden'), { code: 403 });
		mockFile.getMetadata.mockRejectedValue(error);

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});

	test('Refuses a metadata record missing size or modification time', async () => {
		// 1. Both fields are optional in the SDK's types; passing them on would hand the caller `NaN` and an
		//    `Invalid Date` far from their cause, so a broken record is refused with the path named
		mockFile.getMetadata.mockResolvedValue([{}]);

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}": the metadata has no size or updated time`,
		);
	});
});

describe('#exists', () => {
	let mockFile: {
		exists: Mock;
	};

	beforeEach(() => {
		// 1. The SDK answers with a one-element tuple; the stub mirrors that shape so the unwrapping is what gets tested
		mockFile = {
			exists: vi.fn().mockResolvedValue([true]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		// 1. The handle must be asked for the resolved name, not the caller's path
		driver.exists(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls exists on file', async () => {
		driver.exists(sample.path.input);

		// 1. One lookup without options; the SDK's own HEAD request is enough to answer
		expect(mockFile.exists).toHaveBeenCalledOnce();
		expect(mockFile.exists).toHaveBeenCalledWith();
	});

	test('Returns boolean from response array', async () => {
		// 1. The tuple is unwrapped, so callers get the boolean the contract promises rather than an array
		const result = await driver.exists(sample.path.input);
		expect(result).toBe(true);
	});

	test('Throws if the lookup failed', async () => {
		// 1. The SDK only answers false for a missing object, so a failed lookup has to keep travelling; reporting it as
		//    a missing file would make callers act on a wrong answer
		const error = new Error('Service unavailable');
		mockFile.exists.mockRejectedValue(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#move', () => {
	let mockFileSrc: {
		move: Mock;
	};

	let mockFileDest: Record<string, any>;

	beforeEach(() => {
		mockFileSrc = {
			move: vi.fn(),
		};

		mockFileDest = {};

		// 1. Hand out a distinct handle per resolved name, so the test can tell source and destination apart
		driver['file'] = vi.fn().mockImplementation((path) => {
			if (path === sample.path.srcFull) return mockFileSrc;
			if (path === sample.path.destFull) return mockFileDest;
			return null;
		});
	});

	test('Gets file references', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		// 1. Both handles are asked for by their resolved names, so the root applies to source and destination alike
		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to move function', async () => {
		// 1. The SDK moves server-side when given the destination handle, so no bytes travel through this process
		await driver.move(sample.path.src, sample.path.dest);
		expect(mockFileSrc.move).toHaveBeenCalledWith(mockFileDest);
	});
});

describe('#copy', () => {
	let mockFileSrc: {
		copy: Mock;
	};

	let mockFileDest: Record<string, any>;

	beforeEach(() => {
		mockFileSrc = {
			copy: vi.fn(),
		};

		mockFileDest = {};

		// 1. Hand out a distinct handle per resolved name, so the test can tell source and destination apart
		driver['file'] = vi.fn().mockImplementation((path) => {
			if (path === sample.path.srcFull) return mockFileSrc;
			if (path === sample.path.destFull) return mockFileDest;
			return null;
		});
	});

	test('Gets file references', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		// 1. Both handles are asked for by their resolved names, so the root applies to source and destination alike
		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to copy function', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		// 1. The SDK copies server-side when given the destination handle, so no bytes travel through this process
		expect(mockFileSrc.copy).toHaveBeenCalledWith(mockFileDest);
	});
});

describe('#list', () => {
	let mockFiles: string[];

	beforeEach(() => {
		mockFiles = randFilePath({ length: randNumber({ min: 1, max: 10 }) });

		driver['bucket'] = {
			getFiles: vi.fn(),
		} as unknown as Bucket;

		// 1. One page per file: every page but the last returns a next-page query, the last returns none, which is how
		//    the SDK signals the end of a listing
		mockFiles.forEach((file, index) => {
			vi.mocked(driver['bucket'].getFiles).mockResolvedValueOnce([
				[{ name: file }],
				index === mockFiles.length - 1 ? undefined : {},
			] as unknown as void);
		});
	});

	test('Calls getFiles with correct options', async () => {
		await driver.list().next();

		// 1. The stubbed `fullPath` returns `''` for an empty prefix, so the whole bucket is listed
		expect(driver['bucket'].getFiles).toHaveBeenCalledWith({
			prefix: '',
			autoPaginate: false,
			maxResults: 500,
		});
	});

	test('Gets full path of optional prefix', async () => {
		await driver.list(sample.path.input).next();

		// 1. The prefix is resolved like any path, so the root applies to listings as well
		expect(driver['bucket'].getFiles).toHaveBeenCalledWith({
			prefix: sample.path.inputFull,
			autoPaginate: false,
			maxResults: 500,
		});
	});

	test('Yields all paginated files', async () => {
		const output = [];

		// 1. The root is empty, so `toRelativePath` yields the names untouched and the yield order equals the page order
		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(mockFiles);
	});

	test('Skips folder placeholders', async () => {
		// 1. A console-made "folder" is a zero-byte object whose name ends in `/`; a single page carries one next to a
		//    real object, and only the real object may come out, as with the S3 driver
		const placeholder = `${randDirectoryPath().replace(/^\/+/, '')}/`;
		const object = `${placeholder}${randUnique()}.png`;

		vi.mocked(driver['bucket'].getFiles)
			.mockReset()
			.mockResolvedValueOnce([[{ name: placeholder }, { name: object }], undefined] as unknown as void);

		const output = [];

		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([object]);
	});
});

describe('#createChunkedUpload', () => {
	let uri: string;

	let mockFile: {
		createResumableUpload: Mock;
	};

	beforeEach(() => {
		// 1. The SDK answers with a one-element tuple holding the session URI; the stub mirrors that shape
		uri = randUrl();

		mockFile = {
			createResumableUpload: vi.fn().mockResolvedValue([uri]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Opens a session and stores its URI in the metadata', async () => {
		const context = await driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		// 1. The URI is the only state a later `writeChunk` needs, so it has to land in the context the server persists
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
		expect(mockFile.createResumableUpload).toHaveBeenCalledOnce();
		expect(context.metadata).toStrictEqual({ uri });
	});

	test('Creates the metadata map when the client sent none', async () => {
		// 1. A client without `Upload-Metadata` leaves the map undefined; storing the URI must not throw a TypeError
		//    after GCS already accepted the session, which would leak it
		const context = await driver.createChunkedUpload(sample.path.input, {
			size: sample.file.size,
			metadata: undefined,
		});

		expect(context.metadata).toStrictEqual({ uri });
	});
});

describe('#writeChunk', () => {
	let uri: string;
	let hash: string;
	let offset: number;
	let mockWriteStream: PassThrough;

	let mockFile: {
		createWriteStream: Mock;
	};

	beforeEach(() => {
		// 1. Session state a previous call would have left in the context, and a recording write stream in place of the
		//    SDK's, so the options the session is continued with can be asserted without any request
		uri = randUrl();
		hash = randUnique();
		offset = randNumber();
		mockWriteStream = new PassThrough();

		mockFile = {
			createWriteStream: vi.fn().mockReturnValue(mockWriteStream),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Continues the stored session as a partial upload', async () => {
		const context: ChunkedUploadContext = { size: sample.file.size, metadata: { uri, hash } };

		const result = await driver.writeChunk(sample.path.input, sample.stream, offset, context);

		// 1. The session URI and the running hash come from the context, the offset from the server, and
		//    `contentLength` lets GCS finalise the object on its own once the last byte lands
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);

		expect(mockFile.createWriteStream).toHaveBeenCalledWith({
			chunkSize: DEFAULT_CHUNK_SIZE,
			uri,
			offset,
			isPartialUpload: true,
			resumeCRC32C: hash,
			metadata: { contentLength: sample.file.size },
		});

		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);

		// 2. `pipeline` is mocked and consumes nothing, so the offset comes back unchanged
		expect(result).toBe(offset);
	});

	test('Continues the stored session without a content length when the size is unknown', async () => {
		// 1. A deferred-length upload has no total yet; `0` would read as a real total and finalise the object empty,
		//    while an absent key lets the upload library keep the total deferred
		const context: ChunkedUploadContext = { size: undefined, metadata: { uri, hash } };

		await driver.writeChunk(sample.path.input, sample.stream, offset, context);

		expect(mockFile.createWriteStream).toHaveBeenCalledWith({
			chunkSize: DEFAULT_CHUNK_SIZE,
			uri,
			offset,
			isPartialUpload: true,
			resumeCRC32C: hash,
			metadata: {},
		});
	});

	test('Returns the offset advanced by the bytes consumed', async () => {
		// 1. The mocked `pipeline` waits for the chunk to end, so the bytes written below flow through the driver's
		//    `data` listener before the offset is computed
		vi.mocked(pipeline).mockImplementation(
			(source) => new Promise<void>((resolve) => (source as PassThrough).on('end', () => resolve())),
		);

		const pending = driver.writeChunk(sample.path.input, sample.stream, offset, {
			size: sample.file.size,
			metadata: { uri },
		});

		sample.stream.end(Buffer.from(sample.text));

		expect(await pending).toBe(offset + Buffer.byteLength(sample.text));
	});

	test('Keeps the running CRC32C in the context for the next chunk', async () => {
		const context: ChunkedUploadContext = { size: sample.file.size, metadata: { uri } };

		await driver.writeChunk(sample.path.input, sample.stream, offset, context);

		// 1. The hash the SDK emits is what seeds `resumeCRC32C` on the next call, so it has to reach the persisted map
		mockWriteStream.emit('crc32c', hash);

		expect(context.metadata).toStrictEqual({ uri, hash });
	});

	test('Refuses a context that carries no session uri, naming the file', async () => {
		// 1. Without a session URI there is nothing to continue; like the S3 driver, which refuses a missing upload id,
		//    the failure is named here instead of `undefined` reaching the SDK under a `string` type
		const context: ChunkedUploadContext = { size: sample.file.size, metadata: undefined };

		await expect(driver.writeChunk(sample.path.input, sample.stream, offset, context)).rejects.toThrowError(
			`Cannot write a chunk of "${sample.path.input}": the context has no session uri`,
		);

		expect(mockFile.createWriteStream).not.toHaveBeenCalled();
	});
});

describe('#call', () => {
	/**
	 * The OAuth token the mocked credentials hand out; no error or log line may ever show it.
	 *
	 * @defaultValue a fixed fake token
	 */
	const TOKEN = 'ya29.secret-access-token';

	let getAccessToken: Mock;
	let fetchMock: Mock;

	/**
	 * The URL and init of the one request made.
	 *
	 * @returns What `fetch` was called with.
	 */
	const request = (): [
		string,
		{ method: string; headers: Record<string, string>; body?: unknown; redirect?: string },
	] => fetchMock.mock.calls[0] as never;

	/**
	 * Swap the driver's bucket for one whose `Storage` hands out {@link TOKEN}, the way the SDK's does.
	 *
	 * @param target - The driver to fit.
	 */
	const withAuth = (target: StorageDriverGcs): void => {
		// 1. Only the auth client is read by `call()`; the rest of the bucket stays out of the picture
		target['bucket'] = { storage: { authClient: { getAccessToken } } } as unknown as Bucket;
	};

	beforeEach(() => {
		// 1. The real method parser and deadline, credentials that hand out a known token, and a global `fetch` whose
		//    requests are observable
		vi.mocked(parseCallMethod).mockImplementation(parseCallMethodActual);
		vi.mocked(withTimeout).mockImplementation(withTimeoutActual);

		getAccessToken = vi.fn().mockResolvedValue(TOKEN);
		fetchMock = vi.fn().mockImplementation(async () => new Response('{"bindings":[]}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		driver = new StorageDriverGcs({ bucket: 'media bucket' });
		withAuth(driver);
	});

	afterEach(() => {
		// 1. The real `fetch` back for the suites that follow
		vi.unstubAllGlobals();
	});

	test('Requests a path under the API root with the bucket filled in, the token and the query of a GET', async () => {
		// 1. `{bucket}` becomes the encoded bucket name; the parameters go into the URL, no body is sent
		const result = await driver.call('GET /b/{bucket}/iam', { optionsRequestedPolicyVersion: 3 });

		const [url, init] = request();

		expect(url).toBe('https://storage.googleapis.com/storage/v1/b/media%20bucket/iam?optionsRequestedPolicyVersion=3');
		expect(init.method).toBe('GET');
		expect(init.headers['authorization']).toBe(`Bearer ${TOKEN}`);
		expect(init.body).toBeUndefined();
		expect(init.redirect).toBe('manual');
		expect(result).toEqual({ bindings: [] });
	});

	test('Sends the parameters of a PATCH as the JSON body, with the headers of the caller', async () => {
		// 1. The body goes as JSON; the caller's headers go over the driver's
		await driver.call('PATCH /b/{bucket}', { versioning: { enabled: true } }, { headers: { 'X-Goog-A': 'b' } });

		const [url, init] = request();

		expect(url).toBe('https://storage.googleapis.com/storage/v1/b/media%20bucket');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe('{"versioning":{"enabled":true}}');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-goog-a': 'b' });
	});

	test('Puts the parameters where paramsIn says', async () => {
		// 1. A POST whose parameters the API reads from the query
		await driver.call('POST /b/{bucket}/o/a/rewriteTo/b/c/o/d', { maxBytes: 1 }, { paramsIn: 'query' });

		const [url, init] = request();

		expect(url).toContain('?maxBytes=1');
		expect(init.body).toBeUndefined();
	});

	test('Uses the configured apiEndpoint as the root', async () => {
		// 1. An emulator's endpoint without a scheme gets `https`, as the SDK gives it
		driver = new StorageDriverGcs({ bucket: 'b', apiEndpoint: 'gcs.internal:4443/' });
		withAuth(driver);

		await driver.call('GET /b');

		expect(request()[0]).toBe('https://gcs.internal:4443/storage/v1/b');
	});

	test('Answers an empty body with undefined', async () => {
		// 1. A 204 of a delete has no body
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		await expect(driver.call('DELETE /b/{bucket}/o/a.txt')).resolves.toBeUndefined();
	});

	test('Allows a full URL on storage.googleapis.com', async () => {
		// 1. The upload endpoint is on the same host, outside `/storage/v1`
		await driver.call('POST https://storage.googleapis.com/upload/storage/v1/b/b/o', { name: 'a' });

		expect(request()[0]).toBe('https://storage.googleapis.com/upload/storage/v1/b/b/o');
	});

	test('Refuses a full URL on a foreign host before a token is fetched', async () => {
		// 1. The token would go wherever the URL points
		await expect(driver.call('GET https://evil.example/steal')).rejects.toThrow('not on a host of this provider');

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Turns an error status into a ProviderCallError with its status and body, without the token', async () => {
		// 1. A 403 keeps GCS's code and message for the caller; the token appears nowhere in the error
		const body = { error: { code: 403, message: 'The caller does not have permission' } };

		fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 403 }));

		const error = await driver.call('GET /b/{bucket}/iam').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toEqual({
			provider: 'gcs',
			method: 'GET /b/{bucket}/iam',
			status: 403,
			body,
		});

		expect((error as Error).message).toContain('The caller does not have permission');
		expect((error as Error).message).not.toContain(TOKEN);
		expect(JSON.stringify(error)).not.toContain(TOKEN);
		expect((error as Error).cause).toBeUndefined();
	});

	test.each([429, 503])('Makes a single request on a %s, with no retry', async (status) => {
		// 1. Unlike the SDK's client, a failed call is not repeated behind the caller's back — a POST could run twice
		fetchMock.mockResolvedValue(new Response('{"error":{"code":1,"message":"slow down"}}', { status }));

		await expect(driver.call('POST /b/{bucket}/o/a/compose', {})).rejects.toBeInstanceOf(
			status === 429 ? HitRateLimitError : ProviderCallError,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('Turns a 429 into a HitRateLimitError', async () => {
		// 1. GCS asking to slow down becomes the kit's rate-limit error
		fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '7' } }));

		await expect(driver.call('GET /b')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Replaces a failure of the credentials with an error that carries none of them', async () => {
		// 1. The credentials library's error holds the token request; only its code survives, and no cause is kept
		const failure = Object.assign(new Error(`invalid_grant for ${TOKEN}`), {
			code: '400',
			config: { headers: { authorization: `Bearer ${TOKEN}` } },
		});

		getAccessToken.mockRejectedValue(failure);

		const error = await driver.call('GET /b').catch((thrown: unknown) => thrown);

		expect((error as Error).message).toBe('The gcs storage driver could not get an access token (400)');
		expect((error as Error).cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain(TOKEN);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Refuses credentials that yield no token', async () => {
		// 1. A request without a token would only earn a 401
		getAccessToken.mockResolvedValue(null);

		await expect(driver.call('GET /b')).rejects.toThrow('could not get an access token');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Counts the token fetch against the timeout, and sends nothing after it', async () => {
		// 1. A metadata server that never answers ends at the deadline; the late token is never used
		let release: (token: string) => void = () => {};

		getAccessToken.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

		await expect(driver.call('GET /b', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });

		release(TOKEN);
		await new Promise((resolve) => setImmediate(resolve));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Stops before the token fetch when the signal is already aborted', async () => {
		// 1. Nothing is started for a caller who already gave up
		const controller = new AbortController();
		controller.abort(new Error('gone'));

		await expect(driver.call('GET /b', {}, { signal: controller.signal })).rejects.toThrow('gone');

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Gives up at the timeout of the caller while the request hangs', async () => {
		// 1. A request that never answers is aborted at the deadline; the error is matched by shape across copies
		fetchMock.mockImplementation(
			(_url: string, { signal }: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
		);

		await expect(driver.call('GET /b', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });
	});
});

describe('A driver with resumable uploads disabled (tus.enabled: false)', () => {
	let disabledDriver: StorageDriverGcs;

	beforeEach(() => {
		// 1. The flag is the location's way of saying resumable uploads are not served here; a fresh driver is built
		//    because the shared one is created without `tus` options
		disabledDriver = new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: false } });
	});

	test('Refuses to create a chunked upload with the named error', async () => {
		// 1. Refusing up front keeps the driver from opening a session its operator never agreed to serve
		await expect(
			disabledDriver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
		);
	});

	test('Refuses to write a chunk with the named error', async () => {
		// 1. Refusing up front fails with the reason, instead of failing later on the missing session state
		await expect(
			disabledDriver.writeChunk(sample.path.input, sample.stream, 0, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
		);
	});

	test('Refuses to finish a chunked upload with the named error', async () => {
		// 1. Refusing up front keeps the call from silently "finishing" an upload the location never accepted
		await expect(
			disabledDriver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
		);
	});

	test('Refuses to delete a chunked upload with the named error', async () => {
		// 1. Refusing up front keeps the termination from deleting whatever the path happens to name
		await expect(
			disabledDriver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
		);
	});
});
