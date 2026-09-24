/**
 * Tests of `storage-driver-gcs/lib/driver`.
 */
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Bucket, CRC32C, Storage } from '@google-cloud/storage';
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
import { HitRateLimitError, InvalidConfigError, ProviderCallError } from '@novastarter/errors';
import type { ChunkedUploadContext } from '@novastarter/storage';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, withTimeout } from '@novastarter/utils';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverGcsConfig } from './driver.js';
import { StorageDriverGcs } from './driver.js';

vi.mock('@novastarter/utils');
vi.mock('@google-cloud/storage');
vi.mock('node:stream/promises');

const { CRC32C: CRC32CActual } = await vi.importActual<typeof import('@google-cloud/storage')>('@google-cloud/storage');

const { withTimeout: withTimeoutActual } =
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
	// Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
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

	// `@google-cloud/storage` is mocked above, so constructing the driver only records calls and never opens a socket
	driver = new StorageDriverGcs({
		bucket: sample.config.bucket,
	});

	// `joinPath` is mocked and would return `undefined`, so the path resolver gets a fixed input → output map and every
	// method test can assert on the resolved name
	driver['fullPath'] = vi.fn().mockImplementation((input) => {
		if (input === sample.path.src) return sample.path.srcFull;
		if (input === sample.path.dest) return sample.path.destFull;
		if (input === sample.path.input) return sample.path.inputFull;

		return '';
	});
});

afterEach(() => {
	// Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Refuses a missing bucket', () => {
		// Every operation targets the bucket, so its absence is refused at construction rather than on the first
		// request
		expect(() => new StorageDriverGcs({ bucket: '' })).toThrowError(
			new InvalidConfigError({ reason: 'The gcs storage driver needs a "bucket"' }),
		);
	});

	test('Refuses a chunk size GCS would reject when resumable uploads are on', () => {
		// GCS wants multiples of 256 KiB; a chunk below that or off a power of two would fail on the first PATCH
		expect(
			() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: true, chunkSize: 1000 } }),
		).toThrowError(
			new InvalidConfigError({
				reason: 'The gcs storage driver needs a "tus.chunkSize" that is a power of two of at least 256 KiB',
			}),
		);
	});

	test('Refuses a chunk size GCS would reject even when resumable uploads are off', () => {
		// `writeChunk` hands the size to the SDK regardless of the flag, so a value GCS would reject on the first PATCH
		// must not pass construction just because `enabled` is false
		expect(
			() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: false, chunkSize: 1000 } }),
		).toThrowError(
			new InvalidConfigError({
				reason: 'The gcs storage driver needs a "tus.chunkSize" that is a power of two of at least 256 KiB',
			}),
		);
	});

	test.each([[0], [Number.NaN]])(
		'Refuses a configured chunk size of %s instead of falling back to the default',
		(chunkSize) => {
			// `||` would read `0` and `NaN` as "not configured" and silently swap in the default before the validation
			// ran; the configured value itself is what the constructor refuses
			expect(
				() => new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: true, chunkSize } }),
			).toThrowError(
				new InvalidConfigError({
					reason: 'The gcs storage driver needs a "tus.chunkSize" that is a power of two of at least 256 KiB',
				}),
			);
		},
	);

	test('Defaults root path to empty string', () => {
		// The shared driver is built without a root; an empty string keeps `joinPath` and `toRelativePath` no-ops
		// rather than a `'/'` that would end up inside every object name
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		new StorageDriverGcs({
			bucket: sample.config.bucket,
			root: sample.config.root,
		});

		// The root is confined like every key: no leading slash, `.` and `..` resolved
		expect(confinePath).toHaveBeenCalledWith(sample.config.root);
	});

	test('Instantiates Storage object with config options', () => {
		new StorageDriverGcs({
			bucket: sample.config.bucket,
			apiEndpoint: sample.config.apiEndpoint,
		});

		// Only the leftover keys reach the client; `bucket` is the driver's own and must not be forwarded
		expect(Storage).toHaveBeenCalledWith({ apiEndpoint: sample.config.apiEndpoint });
	});

	test('Creates bucket access instance', () => {
		// A hand-made client, so the test can tell which bucket handle the driver keeps
		const mockBucket = {};

		const mockStorage = {
			bucket: vi.fn().mockReturnValue(mockBucket),
		} as unknown as Storage;

		vi.mocked(Storage).mockReturnValue(mockStorage);

		// The handle is opened at construction, so a wrong bucket name fails before any request
		const driver = new StorageDriverGcs({
			bucket: sample.config.bucket,
		});

		expect(mockStorage.bucket).toHaveBeenCalledWith(sample.config.bucket);
		expect(driver.client).toBe(mockBucket);
	});
});

describe('#fullPath', () => {
	beforeEach(() => {
		// A fresh driver with the real `fullPath`, since the shared one is stubbed in the outer `beforeEach`
		driver = new StorageDriverGcs({ bucket: sample.config.bucket });
		driver['root'] = sample.config.root;

		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(confinePath).mockReturnValue(sample.path.input);
	});

	test('Returns the joined path', () => {
		const result = driver['fullPath'](sample.path.input);

		// The caller path is confined first, so a leading `..` is dropped before the root is joined
		expect(confinePath).toHaveBeenCalledWith(sample.path.input);

		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#file', () => {
	let mockFile: Record<string, unknown>;

	beforeEach(() => {
		// A bucket that hands out one known handle, so the test can check the driver returns it untouched
		mockFile = {};

		Object.assign(driver, {
			client: {
				file: vi.fn().mockReturnValue(mockFile),
			} as unknown as Bucket,
		});
	});

	test('Returns file instance', () => {
		// The handle comes straight from the bucket; nothing is wrapped, so tests can swap the factory freely
		const file = driver['file']('/path/to/file');
		expect(file).toBe(mockFile);
	});
});

describe('#read', () => {
	let mockFile: {
		createReadStream: Mock;
	};

	beforeEach(() => {
		mockFile = {
			createReadStream: vi.fn().mockReturnValue(sample.stream),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		await driver.read(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Streams the SDK stream through, whole object without a range', async () => {
		const stream = await driver.read(sample.path.input);

		// Without a range the options object stays empty, so the SDK streams the whole object; the SDK's stream is
		// piped into the one handed out, so its data arrives as is
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
		// `pipe` would only pause the SDK stream and leave its HTTP response open; `pipeline` tears it down
		const source = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(source);

		const stream = await driver.read(sample.path.input);
		const closed = new Promise<void>((resolve) => source.on('close', () => resolve()));

		stream.destroy();
		await closed;

		expect(source.destroyed).toBe(true);
	});

	test('Turns a 404 of the SDK stream into StorageFileNotFoundError, other errors pass as they are', async () => {
		// The SDK opens the object lazily, so a missing object surfaces on the stream, not on the `read()` call
		const missing = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(missing);

		const stream = await driver.read(sample.path.input);
		const failed = new Promise<unknown>((resolve) => stream.on('error', resolve));
		missing.emit('error', Object.assign(new Error('Not Found'), { code: 404 }));

		expect(await failed).toBeInstanceOf(StorageFileNotFoundError);

		// A 403 says nothing about the object, so it must reach the consumer exactly as the SDK reported it
		const denied = new PassThrough();
		mockFile.createReadStream.mockReturnValueOnce(denied);

		const other = await driver.read(sample.path.input);
		const otherFailed = new Promise<unknown>((resolve) => other.on('error', resolve));
		const forbidden = Object.assign(new Error('Forbidden'), { code: 403 });
		denied.emit('error', forbidden);

		expect(await otherFailed).toBe(forbidden);
	});

	test('Passes optional range to createReadStream', async () => {
		// Each bound is forwarded on its own, so an open-ended range keeps the other side absent
		await driver.read('/path/to/file', { range: { start: sample.range.start, end: undefined } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: sample.range.start, end: undefined });

		await driver.read('/path/to/file', { range: sample.range });
		expect(mockFile.createReadStream).toHaveBeenCalledWith(sample.range);

		await driver.read('/path/to/file', { range: { start: undefined, end: sample.range.end } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: undefined, end: sample.range.end });

		// `end: 0` is a bound like any other — the first byte — not an absent one
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
		await driver.write(sample.path.input, sample.stream);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Pipes read stream to write stream in pipeline when stream is passed', async () => {
		await driver.write(sample.path.inputFull, sample.stream);

		// Plain writes are non-resumable single requests; `pipeline` is mocked, so only the wiring is asserted
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ resumable: false });
		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});

	test('Leaves the content type to the SDK when none is given', async () => {
		await driver.write(sample.path.input, sample.stream);

		// No `contentType` key at all, not one set to `undefined`: only an absent key lets the SDK detect the type from
		// the object name, which is the backend default the other drivers fall back to as well
		expect(mockCreateWriteStream.mock.calls[0]?.[0]).toStrictEqual({ resumable: false });
	});

	test('Records the MIME type when one is given', async () => {
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		// The type maps onto `contentType`, which GCS serves back as the object's Content-Type; without it an image
		// stored under a `.bin` name would download instead of render, unlike on the other backends
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ resumable: false, contentType: sample.file.type });
		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});
});

describe('#delete', () => {
	let mockFile: {
		delete: Mock;
	};

	beforeEach(() => {
		mockFile = {
			delete: vi.fn(),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		await driver.delete(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls delete on file', async () => {
		await driver.delete(sample.path.input);

		// Called without options: no `ignoreNotFound`, so a missing object rejects instead of passing as removed
		expect(mockFile.delete).toHaveBeenCalledOnce();
		expect(mockFile.delete).toHaveBeenCalledWith();
	});
});

describe('#deleteChunkedUpload', () => {
	let mockFile: {
		delete: Mock;
	};

	beforeEach(() => {
		mockFile = {
			delete: vi.fn(),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Keeps the object under the path when the upload never finished', async () => {
		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		// GCS writes the object only when the session is finalised, so the object under the path is an older one the
		// aborted upload never replaced, and it must survive the termination
		expect(mockFile.delete).not.toHaveBeenCalled();
	});

	test('Deletes the object of a finished upload, ignoring a missing one', async () => {
		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: { completed: 'true' } });

		// The object may already be gone, so the SDK's 404 for it must not reject the termination
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
		// The JSON API reports the size as a string; the driver has to hand out a number
		mockFile = {
			getMetadata: vi.fn().mockResolvedValue([{ size: String(sample.file.size), updated: sample.file.modified }]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		await driver.stat(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls getMetadata on file', async () => {
		await driver.stat(sample.path.input);

		// One metadata request without options is all a stat needs; size and time come back in the same answer
		expect(mockFile.getMetadata).toHaveBeenCalledOnce();
		expect(mockFile.getMetadata).toHaveBeenCalledWith();
	});

	test('Returns size/updated as size/modified from metadata response', async () => {
		const result = await driver.stat(sample.path.input);

		// `updated` goes through `new Date(...)`, which returns an equal instant for a `Date` input
		expect(result).toStrictEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});
	});

	test('Maps a 404 to the kit error', async () => {
		// The SDK's `ApiError` carries the HTTP status as `code`; 404 becomes the error every backend shares
		const cause = Object.assign(new Error('No such object'), { code: 404 });
		mockFile.getMetadata.mockRejectedValue(cause);

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other SDK error', async () => {
		// A 403 says nothing about whether the object exists, so it must not be reported as "not found"
		const error = Object.assign(new Error('Forbidden'), { code: 403 });
		mockFile.getMetadata.mockRejectedValue(error);

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});

	test('Refuses a metadata record missing size or modification time', async () => {
		// Both fields are optional in the SDK's types; passing them on would hand the caller `NaN` and an `Invalid
		// Date` far from their cause, so a broken record is refused with the path named
		mockFile.getMetadata.mockResolvedValue([{}]);

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`The gcs storage driver got no size or updated time in the metadata of "${sample.path.input}"`,
		);
	});
});

describe('#exists', () => {
	let mockFile: {
		exists: Mock;
	};

	beforeEach(() => {
		// The SDK answers with a one-element tuple; the stub mirrors that shape so the unwrapping is what gets tested
		mockFile = {
			exists: vi.fn().mockResolvedValue([true]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		driver.exists(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls exists on file', async () => {
		driver.exists(sample.path.input);

		// One lookup without options; the SDK's own HEAD request is enough to answer
		expect(mockFile.exists).toHaveBeenCalledOnce();
		expect(mockFile.exists).toHaveBeenCalledWith();
	});

	test('Returns boolean from response array', async () => {
		// The tuple is unwrapped, so callers get the boolean the contract promises rather than an array
		const result = await driver.exists(sample.path.input);
		expect(result).toBe(true);
	});

	test('Throws if the lookup failed', async () => {
		// The SDK only answers false for a missing object, so a failed lookup has to keep travelling; reporting it as a
		// missing file would make callers act on a wrong answer
		const error = new Error('Service unavailable');
		mockFile.exists.mockRejectedValue(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#move', () => {
	let mockFileSrc: {
		move: Mock;
	};

	let mockFileDest: Record<string, unknown>;

	beforeEach(() => {
		mockFileSrc = {
			move: vi.fn(),
		};

		mockFileDest = {};

		// Hand out a distinct handle per resolved name, so the test can tell source and destination apart
		driver['file'] = vi.fn().mockImplementation((path) => {
			if (path === sample.path.srcFull) return mockFileSrc;
			if (path === sample.path.destFull) return mockFileDest;
			return null;
		});
	});

	test('Gets file references', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		// Both handles are asked for by their resolved names, so the root applies to source and destination alike
		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to move function', async () => {
		// The SDK moves server-side when given the destination handle, so no bytes travel through this process
		await driver.move(sample.path.src, sample.path.dest);
		expect(mockFileSrc.move).toHaveBeenCalledWith(mockFileDest);
	});
});

describe('#copy', () => {
	let mockFileSrc: {
		copy: Mock;
	};

	let mockFileDest: Record<string, unknown>;

	beforeEach(() => {
		mockFileSrc = {
			copy: vi.fn(),
		};

		mockFileDest = {};

		// Hand out a distinct handle per resolved name, so the test can tell source and destination apart
		driver['file'] = vi.fn().mockImplementation((path) => {
			if (path === sample.path.srcFull) return mockFileSrc;
			if (path === sample.path.destFull) return mockFileDest;
			return null;
		});
	});

	test('Gets file references', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		// Both handles are asked for by their resolved names, so the root applies to source and destination alike
		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to copy function', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

		// The SDK copies server-side when given the destination handle, so no bytes travel through this process
		expect(mockFileSrc.copy).toHaveBeenCalledWith(mockFileDest);
	});
});

describe('#list', () => {
	let mockFiles: string[];

	beforeEach(() => {
		mockFiles = randFilePath({ length: randNumber({ min: 1, max: 10 }) });

		Object.assign(driver, {
			client: {
				getFiles: vi.fn(),
			} as unknown as Bucket,
		});

		// One page per file: every page but the last returns a next-page query, the last returns none, which is how the
		// SDK signals the end of a listing
		mockFiles.forEach((file, index) => {
			vi.mocked(driver.client.getFiles).mockResolvedValueOnce([
				[{ name: file }],
				index === mockFiles.length - 1 ? undefined : {},
			] as unknown as void);
		});
	});

	test('Calls getFiles with correct options', async () => {
		await driver.list().next();

		// The stubbed `fullPath` returns `''` for an empty prefix, so the whole bucket is listed
		expect(driver.client.getFiles).toHaveBeenCalledWith({
			prefix: '',
			autoPaginate: false,
			maxResults: 500,
		});
	});

	test('Gets full path of optional prefix', async () => {
		await driver.list(sample.path.input).next();

		// The prefix is resolved like any path, so the root applies to listings as well
		expect(driver.client.getFiles).toHaveBeenCalledWith({
			prefix: sample.path.inputFull,
			autoPaginate: false,
			maxResults: 500,
		});
	});

	test('Yields all paginated files', async () => {
		const output = [];

		// The root is empty, so `toRelativePath` yields the names untouched and the yield order equals the page order
		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(mockFiles);
	});

	test('Skips folder placeholders', async () => {
		// A console-made "folder" is a zero-byte object whose name ends in `/`; a single page carries one next to a
		// real object, and only the real object may come out, as with the S3 driver
		const placeholder = `${randDirectoryPath().replace(/^\/+/, '')}/`;
		const object = `${placeholder}${randUnique()}.png`;

		vi.mocked(driver.client.getFiles)
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
		// The SDK answers with a one-element tuple holding the session URI; the stub mirrors that shape
		uri = randUrl();

		mockFile = {
			createResumableUpload: vi.fn().mockResolvedValue([uri]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Opens a session and stores its URI in the metadata', async () => {
		const context = await driver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		// The URI is the only state a later `writeChunk` needs, so it has to land in the context the server persists
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
		expect(mockFile.createResumableUpload).toHaveBeenCalledOnce();
		expect(context.metadata).toStrictEqual({ uri });
	});

	test('Creates the metadata map when the client sent none', async () => {
		// A client without `Upload-Metadata` leaves the map undefined; storing the URI must not throw a TypeError after
		// GCS already accepted the session, which would leak it
		const context = await driver.createChunkedUpload(sample.path.input, {
			size: sample.file.size,
			metadata: undefined,
		});

		expect(context.metadata).toStrictEqual({ uri });
	});

	test('Drops a completion flag sent by the client', async () => {
		// A client forging `completed` in `Upload-Metadata` must not make a later DELETE of an unfinished upload remove
		// the object it was meant to replace
		const context = await driver.createChunkedUpload(sample.path.input, {
			size: sample.file.size,
			metadata: { completed: 'true' },
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
		// Session state a previous call would have left in the context, and a recording write stream in place of the
		// SDK's, so the options the session is continued with can be asserted without any request
		uri = randUrl();
		offset = randNumber();
		mockWriteStream = new PassThrough();

		// `CRC32C` is automocked with the rest of the SDK; the driver checksums the bytes itself, so the real class is
		// put back and the hashes below are real CRC32C values it can resume from
		vi.mocked(CRC32C).mockImplementation((initialValue) => new CRC32CActual(initialValue) as CRC32C);
		vi.mocked(CRC32C.from).mockImplementation((value) => CRC32CActual.from(value) as CRC32C);

		const seed = new CRC32CActual();

		seed.update(Buffer.from(randText()));
		hash = seed.toString();

		mockFile = {
			createWriteStream: vi.fn().mockReturnValue(mockWriteStream),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Continues the stored session as a partial upload', async () => {
		const context: ChunkedUploadContext = { size: sample.file.size, metadata: { uri, hash } };

		const result = await driver.writeChunk(sample.path.input, sample.stream, offset, context);

		// The session URI and the running hash come from the context, the offset from the server, and `contentLength`
		// lets GCS finalise the object on its own once the last byte lands
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

		// `pipeline` is mocked and consumes nothing, so the offset comes back unchanged
		expect(result).toBe(offset);
	});

	test('Continues the stored session without a content length when the size is unknown', async () => {
		// A deferred-length upload has no total yet; `0` would read as a real total and finalise the object empty,
		// while an absent key lets the upload library keep the total deferred
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
		// The mocked `pipeline` waits for the chunk to end, so the bytes written below flow through the driver's `data`
		// listener before the offset is computed
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

	test('Keeps the CRC32C of the whole chunk in the context for the next chunk', async () => {
		// The mocked `pipeline` drains the chunk, and no 308 comes back, so the session holds every byte read
		vi.mocked(pipeline).mockImplementation(
			(source) => new Promise<void>((resolve) => (source as PassThrough).on('end', () => resolve())),
		);

		const context: ChunkedUploadContext = { size: sample.file.size, metadata: { uri, hash } };
		const pending = driver.writeChunk(sample.path.input, sample.stream, offset, context);

		sample.stream.end(Buffer.from(sample.text));
		await pending;

		// The hash seeds `resumeCRC32C` on the next call, so it has to continue the previous one over this chunk
		const expected = CRC32CActual.from(hash);

		expected.update(Buffer.from(sample.text));

		expect(context.metadata).toStrictEqual({ uri, hash: expected.toString() });
	});

	test('Returns the offset GCS reports and the hash of the bytes it kept when a 308 stops short of the chunk end', async () => {
		// A 300,000-byte chunk that does not finish the object: GCS keeps only the first 256 KiB and says so in
		// `Range`, while the SDK finishes the stream without an error
		const body = Buffer.alloc(300_000, 7);

		vi.mocked(pipeline).mockImplementation(
			(source) =>
				new Promise<void>((resolve) =>
					(source as PassThrough).on('end', () => {
						mockWriteStream.emit('response', { status: 308, headers: { range: 'bytes=0-262143' } });
						resolve();
					}),
				),
		);

		const context: ChunkedUploadContext = { size: undefined, metadata: { uri } };
		const pending = driver.writeChunk(sample.path.input, sample.stream, 0, context);

		sample.stream.end(body);

		// The offset is the server's, so the TUS client resends the tail, and the hash covers exactly the kept bytes
		const expected = new CRC32CActual();

		expected.update(body.subarray(0, 262_144));

		expect(await pending).toBe(262_144);
		expect(context.metadata).toStrictEqual({ uri, hash: expected.toString() });
	});

	test('Keeps the offset and the hash when a 308 reports nothing kept', async () => {
		// A chunk shorter than 256 KiB that does not finish the object: GCS keeps none of it and sends no `Range`
		vi.mocked(pipeline).mockImplementation(
			(source) =>
				new Promise<void>((resolve) =>
					(source as PassThrough).on('end', () => {
						mockWriteStream.emit('response', { status: 308, headers: {} });
						resolve();
					}),
				),
		);

		const context: ChunkedUploadContext = { size: undefined, metadata: { uri, hash } };
		const pending = driver.writeChunk(sample.path.input, sample.stream, 0, context);

		sample.stream.end(Buffer.from(sample.text));

		// Nothing advanced: the client resends the whole chunk, resumed from the unchanged hash
		expect(await pending).toBe(0);
		expect(context.metadata).toStrictEqual({ uri, hash });
	});

	test('Marks the upload completed when GCS finalises the object', async () => {
		// The last request of the chunk gets a 200: GCS finalised the object with every byte sent
		vi.mocked(pipeline).mockImplementation(
			(source) =>
				new Promise<void>((resolve) =>
					(source as PassThrough).on('end', () => {
						mockWriteStream.emit('response', { status: 200, headers: {} });
						resolve();
					}),
				),
		);

		const context: ChunkedUploadContext = { size: undefined, metadata: { uri } };
		const pending = driver.writeChunk(sample.path.input, sample.stream, 0, context);

		sample.stream.end(Buffer.from(sample.text));
		await pending;

		// The flag lets a later termination delete the object, which is now this upload's own
		expect(context.metadata?.['completed']).toBe('true');
	});

	test('Refuses an offset reported by GCS that is not a point the driver can checksum', async () => {
		// A session that stops inside the chunk and off a 256 KiB boundary leaves no snapshot to resume from
		vi.mocked(pipeline).mockImplementation(
			(source) =>
				new Promise<void>((resolve) =>
					(source as PassThrough).on('end', () => {
						mockWriteStream.emit('response', { status: 308, headers: { range: 'bytes=0-99' } });
						resolve();
					}),
				),
		);

		const context: ChunkedUploadContext = { size: undefined, metadata: { uri, hash } };
		const pending = driver.writeChunk(sample.path.input, sample.stream, 0, context);

		sample.stream.end(Buffer.alloc(300_000, 7));

		await expect(pending).rejects.toThrowError(
			`The gcs storage driver cannot write a chunk of "${sample.path.input}": the upload session holds 100 bytes, which is not a point the driver can checksum`,
		);

		// The stored hash is left alone rather than replaced with one GCS would not agree with
		expect(context.metadata).toStrictEqual({ uri, hash });
	});

	test('Refuses a context that carries no session uri, naming the file', async () => {
		// Without a session URI there is nothing to continue; like the S3 driver, which refuses a missing upload id,
		// the failure is named here instead of `undefined` reaching the SDK under a `string` type
		const context: ChunkedUploadContext = { size: sample.file.size, metadata: undefined };

		await expect(driver.writeChunk(sample.path.input, sample.stream, offset, context)).rejects.toThrowError(
			`The gcs storage driver cannot write a chunk of "${sample.path.input}": the context has no session uri`,
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
		// Only the auth client is read by `call()`; the rest of the bucket stays out of the picture
		Object.assign(target, { client: { storage: { authClient: { getAccessToken } } } as unknown as Bucket });
	};

	beforeEach(() => {
		// The real deadline, credentials that hand out a known token, and a global `fetch` whose requests are
		// observable
		vi.mocked(withTimeout).mockImplementation(withTimeoutActual);

		getAccessToken = vi.fn().mockResolvedValue(TOKEN);
		fetchMock = vi.fn().mockImplementation(async () => new Response('{"bindings":[]}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		driver = new StorageDriverGcs({ bucket: 'media bucket' });
		withAuth(driver);
	});

	afterEach(() => {
		// The real `fetch` back for the suites that follow
		vi.unstubAllGlobals();
	});

	test('Requests a path under the API root with the bucket filled in, the token and the query of a GET', async () => {
		// `{bucket}` becomes the encoded bucket name; the parameters go into the URL, no body is sent
		const result = await driver.call('GET /b/{bucket}/iam', { optionsRequestedPolicyVersion: 3 });

		const [url, init] = request();

		expect(url).toBe('https://storage.googleapis.com/storage/v1/b/media%20bucket/iam?optionsRequestedPolicyVersion=3');
		expect(init.method).toBe('GET');
		expect(init.headers['authorization']).toBe(`Bearer ${TOKEN}`);
		expect(init.body).toBeUndefined();
		expect(init.redirect).toBe('manual');
		expect(result.data).toEqual({ bindings: [] });
	});

	test('Fills a placeholder from the parameters, encoded, and does not send that parameter again', async () => {
		// `{object}` takes the `object` parameter; `/` in it cannot reshape the path, and only the rest is the query
		await driver.call('GET /b/{bucket}/o/{object}', { object: 'media/a b.jpg', alt: 'json' });

		expect(request()[0]).toBe(
			'https://storage.googleapis.com/storage/v1/b/media%20bucket/o/media%2Fa%20b.jpg?alt=json',
		);
	});

	test('Refuses a placeholder nobody filled before a token is fetched', async () => {
		// Sent, `{object}` would reach GCS as `%7Bobject%7D`
		await expect(driver.call('GET /b/{bucket}/o/{object}')).rejects.toThrow('needs a "object" parameter');

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Answers with the status, the headers lower-cased and the body', async () => {
		// A response header GCS sends, read by its lower-case name
		fetchMock.mockResolvedValue(
			new Response('{"bindings":[]}', {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'X-GUploader-UploadID': 'up-1' },
			}),
		);

		const result = await driver.call('GET /b/{bucket}/iam');

		expect(result).toEqual({
			status: 200,
			headers: { 'content-type': 'application/json', 'x-guploader-uploadid': 'up-1' },
			data: { bindings: [] },
		});
	});

	test('Sends the parameters of a PATCH as the JSON body, with the headers of the caller', async () => {
		// The body goes as JSON; the caller's headers go over the driver's
		await driver.call('PATCH /b/{bucket}', { versioning: { enabled: true } }, { headers: { 'X-Goog-A': 'b' } });

		const [url, init] = request();

		expect(url).toBe('https://storage.googleapis.com/storage/v1/b/media%20bucket');
		expect(init.method).toBe('PATCH');
		expect(init.body).toBe('{"versioning":{"enabled":true}}');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-goog-a': 'b' });
	});

	test('Uses the configured apiEndpoint as the root', async () => {
		// An emulator's endpoint without a scheme gets `https`, as the SDK gives it
		driver = new StorageDriverGcs({ bucket: 'b', apiEndpoint: 'gcs.internal:4443/' });
		withAuth(driver);

		await driver.call('GET /b');

		expect(request()[0]).toBe('https://gcs.internal:4443/storage/v1/b');
	});

	test('Answers an empty body with undefined', async () => {
		// A 204 of a delete has no body
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		const result = await driver.call('DELETE /b/{bucket}/o/a.txt');

		expect(result).toMatchObject({ status: 204, data: undefined });
	});

	test('Allows a full URL on storage.googleapis.com', async () => {
		// The upload endpoint is on the same host, outside `/storage/v1`
		await driver.call('POST https://storage.googleapis.com/upload/storage/v1/b/b/o', { name: 'a' });

		expect(request()[0]).toBe('https://storage.googleapis.com/upload/storage/v1/b/b/o');
	});

	test('Refuses a full URL on a foreign host before a token is fetched', async () => {
		// The token would go wherever the URL points
		await expect(driver.call('GET https://evil.example/steal')).rejects.toThrow('not on a host of this provider');

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Turns an error status into a ProviderCallError with its status and body, without the token', async () => {
		// A 403 keeps GCS's code and message for the caller; the token appears nowhere in the error
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
		// Unlike the SDK's client, a failed call is not repeated behind the caller's back — a POST could run twice
		fetchMock.mockResolvedValue(new Response('{"error":{"code":1,"message":"slow down"}}', { status }));

		await expect(driver.call('POST /b/{bucket}/o/a/compose', {})).rejects.toBeInstanceOf(
			status === 429 ? HitRateLimitError : ProviderCallError,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('Turns a 429 into a HitRateLimitError', async () => {
		// GCS asking to slow down becomes the kit's rate-limit error
		fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '7' } }));

		await expect(driver.call('GET /b')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Replaces a failure of the credentials with an error that carries none of them', async () => {
		// The credentials library's error holds the token request; none of it survives, and no cause is kept
		const failure = Object.assign(new Error(`invalid_grant for ${TOKEN}`), {
			code: '400',
			config: { headers: { authorization: `Bearer ${TOKEN}` } },
		});

		getAccessToken.mockRejectedValue(failure);

		const error = await driver.call('GET /b').catch((thrown: unknown) => thrown);

		expect((error as Error).message).toBe('gcs: the credentials for the call could not be had (Error)');
		expect((error as Error).cause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain(TOKEN);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Refuses credentials that yield no token', async () => {
		// A request without a token would only earn a 401
		getAccessToken.mockResolvedValue(null);

		await expect(driver.call('GET /b')).rejects.toThrow('gcs: the credentials for the call could not be had (Error)');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Counts the token fetch against the timeout, and sends nothing after it', async () => {
		// A metadata server that never answers ends at the deadline; the late token is never used
		/**
		 * Resolve the pending token fetch with a token; a no-op until the promise's own resolver replaces it.
		 */
		let release: (token: string) => void = () => {};

		getAccessToken.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

		await expect(driver.call('GET /b', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });

		release(TOKEN);
		await new Promise((resolve) => setImmediate(resolve));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Stops before the token fetch when the signal is already aborted', async () => {
		// Nothing is started for a caller who already gave up
		const controller = new AbortController();
		controller.abort(new Error('gone'));

		await expect(driver.call('GET /b', {}, { signal: controller.signal })).rejects.toThrow('gone');

		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('Gives up at the timeout of the caller while the request hangs', async () => {
		// A request that never answers is aborted at the deadline; the error is matched by shape across copies
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
		// A fresh driver, because the shared one is created without `tus` options
		disabledDriver = new StorageDriverGcs({ bucket: sample.config.bucket, tus: { enabled: false } });
	});

	test('Refuses to create a chunked upload with the named error', async () => {
		// Refusing up front keeps the driver from opening a session its operator never agreed to serve
		await expect(
			disabledDriver.createChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			new InvalidConfigError({
				reason:
					'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
			}),
		);
	});

	test('Refuses to write a chunk with the named error', async () => {
		// Refusing up front fails with the reason, instead of failing later on the missing session state
		await expect(
			disabledDriver.writeChunk(sample.path.input, sample.stream, 0, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			new InvalidConfigError({
				reason:
					'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
			}),
		);
	});

	test('Refuses to finish a chunked upload with the named error', async () => {
		// Refusing up front keeps the call from silently "finishing" an upload the location never accepted
		await expect(
			disabledDriver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			new InvalidConfigError({
				reason:
					'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
			}),
		);
	});

	test('Refuses to delete a chunked upload with the named error', async () => {
		// Refusing up front keeps the termination from deleting whatever the path happens to name
		await expect(
			disabledDriver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).rejects.toThrowError(
			new InvalidConfigError({
				reason:
					'The gcs storage driver refuses chunked uploads because resumable uploads are disabled (tus.enabled is false)',
			}),
		);
	});
});
