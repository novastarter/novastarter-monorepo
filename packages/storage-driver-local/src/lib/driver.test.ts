import type { Dir, WriteStream } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, opendir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	randDirectoryPath,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randText,
	randGitShortSha as randUnique,
	randWord,
} from '@ngneat/falso';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverLocalConfig } from './driver.js';
import { StorageDriverLocal } from './driver.js';

vi.mock('@novastarter/logger');
vi.mock('node:path');
vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('node:stream/promises');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 *
 * The `path.*Full` values are what the stubbed `fullPath` returns for the matching `path.*` input.
 */
let sample: {
	config: Required<StorageDriverLocalConfig>;
	path: {
		root: string;
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
	text: string;
	stream: PassThrough;
	file: {
		type: string;
		size: number;
		modified: Date;
	};
};

/**
 * Driver under test, rebuilt before every test on top of the fresh fixture.
 */
let driver: StorageDriverLocal;

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			root: randDirectoryPath(),
		},
		path: {
			root: randUnique() + randDirectoryPath(),
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
		text: randText(),
		stream: new PassThrough(),
		file: {
			type: randFileType(),
			size: randNumber(),
			modified: randPastDate(),
		},
	};

	// 2. `node:fs`, `node:fs/promises` and `node:path` are auto-mocked above, so the driver never touches the disk
	driver = new StorageDriverLocal({ root: sample.config.root });

	// 3. Stub the private path resolver with a lookup table, so assertions can match exact paths without depending on
	//    the mocked `join`
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
	test('Refuses a missing root', () => {
		// 1. Without a root every path would resolve against the working directory, which is never what was meant
		expect(() => new StorageDriverLocal({ root: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The local storage driver needs a "root"]`,
		);
	});

	test('Resolves root based on input', () => {
		// 1. The shared driver from `beforeEach` already ran the constructor, so its `resolve` call is recorded
		expect(resolve).toHaveBeenCalledWith(sample.config.root);
	});

	test('Saves resolved path to private var root', () => {
		// 1. `resolve` is auto-mocked; a fixed return value shows the driver stores the resolved result, not the raw root
		const mockResolved = randDirectoryPath();
		vi.mocked(resolve).mockReturnValueOnce(mockResolved);
		const driver = new StorageDriverLocal({ root: sample.config.root });
		expect(driver['root']).toBe(mockResolved);
	});
});

describe('#fullPath', () => {
	beforeEach(() => {
		// 1. The shared `fullPath` stub would hide the real implementation, which is what this block tests
		vi.mocked(driver['fullPath']).mockRestore();
	});

	test('Joins passed filepath with system separator', () => {
		// 1. A fresh driver is needed: the shared one had its `fullPath` replaced on the instance, and `mockRestore`
		//    cannot bring the prototype method back
		const driver = new StorageDriverLocal({ root: sample.config.root });

		driver['fullPath'](sample.path.input);

		// 2. The inner join with `sep` is what pins the caller path inside the root
		expect(join).toHaveBeenCalledWith(sep, sample.path.input);
	});

	test('Joins config root with sep prefixed filepath', () => {
		// 1. Two queued return values stand in for the inner and outer `join` calls, in that order
		const driver = new StorageDriverLocal({ root: sample.path.root });
		vi.mocked(join).mockReturnValueOnce(sample.path.input).mockReturnValueOnce(sample.path.inputFull);

		const filepath = driver['fullPath'](sample.path.input);

		expect(join).toHaveBeenCalledTimes(2);
		expect(filepath).toBe(sample.path.inputFull);
	});
});

describe('#ensureDir', () => {
	test('Calls node:fs/promises mkdir with passed path', async () => {
		// 1. `recursive` is what makes the call safe for existing directories and missing parents alike
		await driver['ensureDir'](sample.path.input);
		expect(mkdir).toHaveBeenCalledWith(sample.path.input, { recursive: true });
	});
});

describe('#read', () => {
	test('Calls createReadStream with full path', async () => {
		// 1. Without a range the options object must stay empty, so the stream reads the whole file
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(createReadStream).toHaveBeenCalledWith(sample.path.inputFull, {});
	});

	test('Calls createReadStream with optional start range', async () => {
		// 1. Only the given bound may appear; an explicit `end: undefined` would be a different options object
		await driver.read(sample.path.input, { range: { start: sample.range.start, end: undefined } });

		expect(createReadStream).toHaveBeenCalledWith(sample.path.inputFull, { start: sample.range.start });
	});

	test('Calls createReadStream with optional end range', async () => {
		// 1. Only the given bound may appear; an explicit `start: undefined` would be a different options object
		await driver.read(sample.path.input, { range: { start: undefined, end: sample.range.end } });

		expect(createReadStream).toHaveBeenCalledWith(sample.path.inputFull, { end: sample.range.end });
	});

	test('Calls createReadStream with optional start and end range', async () => {
		// 1. Both bounds given: the options object must equal the range as-is, nothing added or renamed
		await driver.read(sample.path.input, { range: sample.range });

		expect(createReadStream).toHaveBeenCalledWith(sample.path.inputFull, sample.range);
	});
});

describe('#stat', () => {
	test('Calls node:fs/promises stat with full path', async () => {
		// 1. An empty object is enough: the test only checks which path was asked for, not the returned numbers
		vi.mocked(stat).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof stat>>);

		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(stat).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Throws the kit error if stat does not return info', async () => {
		// 1. The auto-mocked `stat` resolves `undefined`, which is the misbehaving-filesystem case the guard covers
		await expect(driver.stat(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Maps a missing file to the kit error', async () => {
		// 1. ENOENT is what the filesystem answers for a missing file; the driver turns it into the error every backend
		//    shares, keeping the original as cause
		const cause = Object.assign(new Error(), { code: 'ENOENT' });
		vi.mocked(stat).mockRejectedValueOnce(cause);

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Rethrows any other filesystem error', async () => {
		// 1. A permission error says nothing about whether the file exists, so it must not be reported as "not found"
		const error = Object.assign(new Error(), { code: 'EACCES' });
		vi.mocked(stat).mockRejectedValueOnce(error);

		await expect(driver.stat(sample.path.input)).rejects.toBe(error);
	});
});

describe('#exists', () => {
	test('Calls node:fs/promises access with full path', async () => {
		// 1. A resolved value of any shape means "present"; only the path handed to `access` is under test here
		vi.mocked(access).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof access>>);

		await driver.exists(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(access).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns true if access resolves', async () => {
		// 1. `access` resolving is the only signal of presence the driver relies on
		vi.mocked(access).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof access>>);

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(true);
	});

	test('Returns false if the file does not exist', async () => {
		// 1. `node:fs` errors carry the code as a property, which `Object.assign` reproduces on a plain Error
		vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOENT' }));

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(false);
	});

	test('Returns false if a parent of the path is a file', async () => {
		// 1. ENOTDIR is what the filesystem answers when a directory segment of the path is actually a file
		vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOTDIR' }));

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(false);
	});

	/**
	 * Reporting an unreadable path as "the file isn't there" makes callers act on a wrong answer, for
	 * example by serving a permission error for a file that does exist.
	 */
	test('Throws if the path could not be checked', async () => {
		const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });

		vi.mocked(access).mockRejectedValueOnce(error);

		await expect(driver.exists(sample.path.input)).rejects.toThrow(error);
	});
});

describe('#move', () => {
	beforeEach(() => {
		// 1. `ensureDir` is stubbed so the tests can assert it was asked for the right directory
		driver['ensureDir'] = vi.fn();
	});

	test('Makes sure destination location exists', async () => {
		// 1. `dirname` is auto-mocked; a fixed return value shows the parent of the resolved destination is created
		const mockDirname = randDirectoryPath();
		vi.mocked(dirname).mockReturnValueOnce(mockDirname);

		await driver.move(sample.path.src, sample.path.dest);

		expect(dirname).toHaveBeenCalledWith(sample.path.destFull);
		expect(driver['ensureDir']).toHaveBeenCalledWith(mockDirname);
	});

	test('Calls node:fs/promises with full path for both src and dest', async () => {
		// 1. Both paths must go through `fullPath`, so neither side of the rename can escape the root
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);
		expect(rename).toHaveBeenCalledWith(sample.path.srcFull, sample.path.destFull);
	});
});

describe('#copy', () => {
	beforeEach(() => {
		// 1. `ensureDir` is stubbed so the tests can assert it was asked for the right directory
		driver['ensureDir'] = vi.fn();
	});

	test('Makes sure destination location exists', async () => {
		// 1. `dirname` is auto-mocked; a fixed return value shows the parent of the resolved destination is created
		const mockDirname = randDirectoryPath();
		vi.mocked(dirname).mockReturnValueOnce(mockDirname);

		await driver.copy(sample.path.src, sample.path.dest);

		expect(dirname).toHaveBeenCalledWith(sample.path.destFull);
		expect(driver['ensureDir']).toHaveBeenCalledWith(mockDirname);
	});

	test('Calls node:fs/promises copyFile with full path for both src and dest', async () => {
		// 1. Both paths must go through `fullPath`, so neither side of the copy can escape the root
		await driver.copy(sample.path.src, sample.path.dest);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);
		expect(copyFile).toHaveBeenCalledWith(sample.path.srcFull, sample.path.destFull);
	});
});

describe('#write', () => {
	beforeEach(() => {
		// 1. `ensureDir` is stubbed so the tests can assert it was asked for the right directory
		driver['ensureDir'] = vi.fn();
	});

	test('Makes sure destination location exists', async () => {
		// 1. `dirname` is auto-mocked; a fixed return value shows the parent of the resolved target is created
		const mockDirname = randDirectoryPath();
		vi.mocked(dirname).mockReturnValueOnce(mockDirname);

		await driver.write(sample.path.input, sample.stream);

		expect(dirname).toHaveBeenCalledWith(sample.path.inputFull);
		expect(driver['ensureDir']).toHaveBeenCalledWith(mockDirname);
	});

	test('Creates write stream to file path when a readstream is passed', async () => {
		// 1. The write stream must target the resolved path, with no extra options that would change its mode
		await driver.write(sample.path.input, sample.stream);

		expect(createWriteStream).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Passes read stream to write stream in pipeline', async () => {
		// 1. Any object works as the write stream: `pipeline` is mocked, so only the identity of what it received matters
		const mockWriteStream = {};
		vi.mocked(createWriteStream).mockReturnValueOnce(mockWriteStream as unknown as WriteStream);

		await driver.write(sample.path.input, sample.stream);

		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});
});

describe('#delete', () => {
	test('Calls node:fs/promises unlink with full filepath', async () => {
		// 1. `unlink` is expected rather than `rm`, so a directory can never be removed through the driver
		await driver.delete(sample.path.input);

		expect(unlink).toHaveBeenCalledWith(sample.path.inputFull);
	});
});

describe('#list', () => {
	test('Returns iterable listGenerator with full prefix', () => {
		// 1. The generator body only runs on the first `next()`, so the resolved prefix is the one observable side effect
		driver.list(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});
});

describe('#listGenerator', () => {
	let mockFiles: string[];

	beforeEach(() => {
		// 1. A synchronous generator stands in for the `Dir` handle: `for await` accepts a plain iterable, and each
		//    entry only needs the `name` and type probes the generator reads
		mockFiles = randFilePath({ length: 3 });

		vi.mocked(opendir).mockResolvedValue(
			(function* () {
				for (const mockFile of mockFiles) {
					yield { name: mockFile, isFile: () => true, isDirectory: () => false };
				}
			})() as unknown as Dir,
		);

		// 2. `join` is auto-mocked; returning the second argument keeps entry names intact for the prefix comparison
		vi.mocked(join).mockImplementation((_, filepath) => filepath);
	});

	test('Opens directory if directory is passed', async () => {
		// 1. A trailing separator marks a directory, so it must be opened as-is rather than its parent
		const mockFolder = `${randDirectoryPath()}/`;

		const iterator = driver['listGenerator'](mockFolder);
		await iterator.next();

		expect(opendir).toHaveBeenCalledWith(mockFolder);
	});

	test('Opens directory if file or string prefix is passed', async () => {
		// 1. Without a trailing separator the prefix may end mid-name, so its parent directory is the one scanned
		const mockRoot = `/${randWord()}/`;
		const mockPrefix = randWord();

		vi.mocked(dirname).mockReturnValueOnce(mockRoot);

		const iterator = driver['listGenerator'](`${mockRoot}${mockPrefix}`);
		await iterator.next();

		expect(dirname).toHaveBeenCalledWith(`${mockRoot}${mockPrefix}`);
		expect(opendir).toHaveBeenCalledWith(mockRoot);
	});

	test('Ignores files that do not start with the prefix', async () => {
		// 1. Every entry sits under a different prefix than the one asked for, so the generator must finish empty
		vi.mocked(opendir).mockResolvedValue(
			(function* () {
				for (const mockFile of mockFiles) {
					yield { name: `/right-prefix/${mockFile}`, isFile: () => true, isDirectory: () => false };
				}
			})() as unknown as Dir,
		);

		vi.mocked(join).mockImplementation((_, filepath) => filepath);

		const iterator = driver['listGenerator'](`/wrong-prefix/${mockFiles[0]}`);
		const output = await iterator.next();

		expect(output).toStrictEqual({
			done: true,
			value: undefined,
		});
	});

	test('Returns filepath string relative from configured root if path is file', async () => {
		// 1. `relative` is auto-mocked; returning its second argument shows the yielded value is the relativised path
		vi.mocked(relative).mockImplementation((_, x) => x);

		const iterator = driver['listGenerator']('');

		const output = [];

		for await (const filename of iterator) {
			output.push(filename);
		}

		expect(output).toStrictEqual(mockFiles);
	});

	test('Recursively calls itself to traverse directories', async () => {
		vi.mocked(relative).mockImplementation((_, x) => x);

		const mockDirectory = randDirectoryPath();
		const mockFile = randFilePath();

		// 1. The shared `opendir` mock is replaced by two queued answers: the first listing holds a directory, the
		//    second one (the recursive call) holds the file that must come out
		vi.mocked(opendir).mockReset();

		vi.mocked(opendir).mockResolvedValueOnce(
			(function* () {
				yield { name: mockDirectory, isFile: () => false, isDirectory: () => true };
			})() as unknown as Dir,
		);

		vi.mocked(opendir).mockResolvedValueOnce(
			(function* () {
				yield { name: mockFile, isFile: () => true, isDirectory: () => false };
			})() as unknown as Dir,
		);

		const iterator = driver['listGenerator']('');

		const output = [];

		for await (const filename of iterator) {
			output.push(filename);
		}

		// 2. Only the file is yielded; the directory itself never appears in the listing
		expect(output).toStrictEqual([mockFile]);
	});
});
