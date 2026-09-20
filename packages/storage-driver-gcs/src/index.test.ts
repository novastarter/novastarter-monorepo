import { join } from 'node:path';
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
import { normalizePath } from '@novastarter/utils';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DriverGCSConfig } from './index.js';
import { DriverGCS } from './index.js';

vi.mock('@novastarter/utils');
vi.mock('@google-cloud/storage');
vi.mock('node:path');
vi.mock('node:stream/promises');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	config: Required<DriverGCSConfig>;
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
let driver: DriverGCS;

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
	driver = new DriverGCS({
		bucket: sample.config.bucket,
	});

	// 3. Stub the path resolver with a fixed input → output map, so every method test can assert on the resolved name
	//    without depending on `join`/`normalizePath`, which are mocked and would return `undefined`
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
	test('Defaults root path to empty string', () => {
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		new DriverGCS({
			bucket: sample.config.bucket,
			root: sample.config.root,
		});

		// 1. `removeLeading` is what keeps a leading slash out of object names
		expect(normalizePath).toHaveBeenCalledWith(sample.config.root, { removeLeading: true });
	});

	test('Instantiates Storage object with config options', () => {
		new DriverGCS({
			bucket: sample.config.bucket,
			apiEndpoint: sample.config.apiEndpoint,
		});

		// 1. Only the leftover keys reach the client; `bucket` is the driver's own and must not be forwarded
		expect(Storage).toHaveBeenCalledWith({ apiEndpoint: sample.config.apiEndpoint });
	});

	test('Creates bucket access instance', () => {
		const mockBucket = {};

		const mockStorage = {
			bucket: vi.fn().mockReturnValue(mockBucket),
		} as unknown as Storage;

		vi.mocked(Storage).mockReturnValue(mockStorage);

		const driver = new DriverGCS({
			bucket: sample.config.bucket,
		});

		expect(mockStorage.bucket).toHaveBeenCalledWith(sample.config.bucket);
		expect(driver['bucket']).toBe(mockBucket);
	});
});

describe('#fullPath', () => {
	beforeEach(() => {
		// 1. A fresh driver with the real `fullPath`, since the shared one is stubbed in the outer `beforeEach`
		driver = new DriverGCS({ bucket: sample.config.bucket });
		driver['root'] = sample.config.root;

		vi.mocked(join).mockReturnValue(sample.path.src);
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);
	});

	test('Returns normalized joined path', () => {
		const result = driver['fullPath'](sample.path.input);

		// 1. Root and input are joined first, and only the joined result is normalised
		expect(join).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(normalizePath).toHaveBeenCalledWith(sample.path.src);
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#file', () => {
	let mockFile: any;

	beforeEach(() => {
		mockFile = {};

		driver['bucket'] = {
			file: vi.fn().mockReturnValue(mockFile),
		} as unknown as Bucket;
	});

	test('Returns file instance', () => {
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

	test('Returns stream from createReadStream', async () => {
		const stream = await driver.read(sample.path.input);

		// 1. Without a range the options object stays empty, so the SDK streams the whole object
		expect(stream).toBe(sample.stream);
		expect(mockFile.createReadStream).toHaveBeenCalledOnce();
		expect(mockFile.createReadStream).toHaveBeenCalledWith({});
	});

	test('Passes optional range to createReadStream', async () => {
		// 1. Each bound is forwarded on its own, so an open-ended range keeps the other side absent
		await driver.read('/path/to/file', { range: { start: sample.range.start, end: undefined } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: sample.range.start, end: undefined });

		await driver.read('/path/to/file', { range: sample.range });
		expect(mockFile.createReadStream).toHaveBeenCalledWith(sample.range);

		await driver.read('/path/to/file', { range: { start: undefined, end: sample.range.end } });
		expect(mockFile.createReadStream).toHaveBeenCalledWith({ start: undefined, end: sample.range.end });
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

		// 1. Plain writes are non-resumable single requests; `pipeline` is mocked, so only the wiring is asserted
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ resumable: false });
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

		expect(mockFile.delete).toHaveBeenCalledOnce();
		expect(mockFile.delete).toHaveBeenCalledWith();
	});
});

describe('#stat', () => {
	let mockFile: {
		getMetadata: Mock;
	};

	beforeEach(() => {
		mockFile = {
			getMetadata: vi.fn().mockResolvedValue([{ size: sample.file.size, updated: sample.file.modified }]),
		};

		driver['file'] = vi.fn().mockReturnValue(mockFile);
	});

	test('Gets file reference', async () => {
		await driver.stat(sample.path.input);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls getMetadata on file', async () => {
		await driver.stat(sample.path.input);

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
});

describe('#exists', () => {
	let mockFile: {
		exists: Mock;
	};

	beforeEach(() => {
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

		expect(mockFile.exists).toHaveBeenCalledOnce();
		expect(mockFile.exists).toHaveBeenCalledWith();
	});

	test('Returns boolean from response array', async () => {
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

		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to move function', async () => {
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

		expect(driver['file']).toHaveBeenCalledWith(sample.path.srcFull);
		expect(driver['file']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Passes dest file ref to copy function', async () => {
		await driver.copy(sample.path.src, sample.path.dest);

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

		expect(driver['bucket'].getFiles).toHaveBeenCalledWith({
			prefix: sample.path.inputFull,
			autoPaginate: false,
			maxResults: 500,
		});
	});

	test('Yields all paginated files', async () => {
		const output = [];

		// 1. The root is empty here, so `substring(0)` leaves the names untouched and the yield order equals the page order
		for await (const filepath of driver.list()) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(mockFiles);
	});
});
