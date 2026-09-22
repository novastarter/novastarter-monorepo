/**
 * Tests of `storage-driver-local/lib/driver`.
 */
import type { Dir, ReadStream, WriteStream } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, opendir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
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
import { useLogger } from '@novastarter/logger';
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
	let mockSource: PassThrough;

	beforeEach(() => {
		// 1. `createReadStream` is auto-mocked and would return nothing; the driver wires the file stream into the one
		//    it hands out, so a real stream has to stand in for the file
		mockSource = new PassThrough();
		vi.mocked(createReadStream).mockImplementation(() => mockSource as unknown as ReadStream);
	});

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

	test('Forwards a zero end, which asks for the first byte', async () => {
		// 1. `end: 0` is a bound like any other; dropped by a truthiness check it would read the whole file
		await driver.read(sample.path.input, { range: { start: 0, end: 0 } });

		expect(createReadStream).toHaveBeenCalledWith(sample.path.inputFull, { start: 0, end: 0 });
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

	test('Streams the file through, so its data arrives as is', async () => {
		const stream = await driver.read(sample.path.input);

		// 1. The file stream is piped into the one handed out, so every byte written to the file side comes out unchanged
		const chunks: Buffer[] = [];
		const done = new Promise<void>((resolve) => stream.on('end', resolve));
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));
		mockSource.end(sample.text);
		await done;

		expect(Buffer.concat(chunks).toString()).toBe(sample.text);
	});

	test('Reports a missing file on the stream as StorageFileNotFoundError, keeping the cause', async () => {
		// 1. The file is opened lazily, so ENOENT surfaces on the stream, not on the `read()` call; the consumer must
		//    still get the error every backend shares, with the filesystem error attached for diagnosis
		const cause = Object.assign(new Error('no such file'), { code: 'ENOENT' });

		const stream = await driver.read(sample.path.input);
		const failed = new Promise<unknown>((resolve) => stream.on('error', resolve));
		mockSource.emit('error', cause);

		const error = await failed;

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input }, cause });
	});

	test('Reports a parent that is a file as StorageFileNotFoundError', async () => {
		// 1. ENOTDIR is what the filesystem answers when a directory segment of the path is actually a file; the file
		//    cannot exist there, so it is "not found" like ENOENT
		const stream = await driver.read(sample.path.input);
		const failed = new Promise<unknown>((resolve) => stream.on('error', resolve));
		mockSource.emit('error', Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }));

		expect(await failed).toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Passes any other file stream error through as it is', async () => {
		// 1. A permission error says nothing about whether the file exists, so it must not be reported as "not found"
		const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });

		const stream = await driver.read(sample.path.input);
		const failed = new Promise<unknown>((resolve) => stream.on('error', resolve));
		mockSource.emit('error', denied);

		expect(await failed).toBe(denied);
	});

	test('Destroying the handed-out stream destroys the file stream too, so a gone client frees the descriptor', async () => {
		const stream = await driver.read(sample.path.input);
		const closed = new Promise<void>((resolve) => mockSource.on('close', () => resolve()));

		// 1. `pipe` would only pause the file stream and keep the file open; `pipeline` tears it down
		stream.destroy();
		await closed;

		expect(mockSource.destroyed).toBe(true);
	});
});

describe('#stat', () => {
	test('Calls node:fs/promises stat with full path', async () => {
		// 1. An object with `isFile` is enough: the test only checks which path was asked for, not the returned numbers
		vi.mocked(stat).mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>);

		await driver.stat(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(stat).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Throws the kit error if stat does not return info', async () => {
		// 1. The auto-mocked `stat` resolves `undefined`, which is the misbehaving-filesystem case the guard covers
		await expect(driver.stat(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Reports a directory as missing', async () => {
		// 1. A directory has a size and an `mtime` too, but no `read()` can ever stream it; it reads as missing, the
		//    way the object stores answer for a prefix
		vi.mocked(stat).mockResolvedValueOnce({ isFile: () => false } as unknown as Awaited<ReturnType<typeof stat>>);

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
	test('Calls node:fs/promises stat with full path', async () => {
		// 1. `stat` proves both presence and file-ness; only the path handed to it is under test here
		vi.mocked(stat).mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>);

		await driver.exists(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(stat).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Returns true if the path is a file', async () => {
		// 1. Only a file counts as present: `read()` can stream it, as it can an object on every other backend
		vi.mocked(stat).mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>);

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(true);
	});

	test('Returns false for a directory', async () => {
		// 1. `access` used to resolve for directories too, answering `true` for a folder no `read()` can stream; the
		//    object stores answer `false` there, and so does this driver
		vi.mocked(stat).mockResolvedValueOnce({ isFile: () => false } as unknown as Awaited<ReturnType<typeof stat>>);

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(false);
	});

	test('Returns false if the file does not exist', async () => {
		// 1. `node:fs` errors carry the code as a property, which `Object.assign` reproduces on a plain Error
		vi.mocked(stat).mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOENT' }));

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(false);
	});

	test('Returns false if a parent of the path is a file', async () => {
		// 1. ENOTDIR is what the filesystem answers when a directory segment of the path is actually a file
		vi.mocked(stat).mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOTDIR' }));

		const result = await driver.exists(sample.path.input);

		expect(result).toBe(false);
	});

	test('Throws if the path could not be checked', async () => {
		// 1. Reporting an unreadable path as "the file isn't there" makes callers act on a wrong answer, for example by
		//    serving a permission error for a file that does exist
		const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });

		vi.mocked(stat).mockRejectedValueOnce(error);

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

	/**
	 * Path the write stream was opened on: the temporary sibling the driver writes to before the final `rename`.
	 */
	function writtenPath(): string {
		return String(vi.mocked(createWriteStream).mock.calls[0]?.[0]);
	}

	test('Makes sure destination location exists', async () => {
		// 1. `dirname` is auto-mocked; a fixed return value shows the parent of the resolved target is created
		const mockDirname = randDirectoryPath();
		vi.mocked(dirname).mockReturnValueOnce(mockDirname);

		await driver.write(sample.path.input, sample.stream);

		expect(dirname).toHaveBeenCalledWith(sample.path.inputFull);
		expect(driver['ensureDir']).toHaveBeenCalledWith(mockDirname);
	});

	test('Creates the write stream on a temporary sibling of the target path', async () => {
		await driver.write(sample.path.input, sample.stream);

		// 1. The temporary file sits next to the target, so the final `rename` stays on one filesystem, and carries a
		//    random suffix, so two concurrent writes of the same path never share it
		expect(createWriteStream).toHaveBeenCalledOnce();
		expect(writtenPath().startsWith(`${sample.path.inputFull}.`)).toBe(true);
		expect(writtenPath()).toMatch(/\.[0-9a-f]{12}\.tmp$/);
	});

	test('Uses a different temporary path for every write', async () => {
		// 1. Two writes of the same path must not collide on disk
		await driver.write(sample.path.input, sample.stream);
		await driver.write(sample.path.input, sample.stream);

		const [first, second] = vi.mocked(createWriteStream).mock.calls.map((call) => call[0]);

		expect(first).not.toBe(second);
	});

	test('Passes read stream to write stream in pipeline', async () => {
		// 1. Any object works as the write stream: `pipeline` is mocked, so only the identity of what it received matters
		const mockWriteStream = {};
		vi.mocked(createWriteStream).mockReturnValueOnce(mockWriteStream as unknown as WriteStream);

		await driver.write(sample.path.input, sample.stream);

		expect(pipeline).toHaveBeenCalledWith(sample.stream, mockWriteStream);
	});

	test('Renames the temporary file over the target once the pipeline resolved', async () => {
		await driver.write(sample.path.input, sample.stream);

		// 1. The rename is what publishes the content; it must follow the pipeline, never run beside it
		expect(rename).toHaveBeenCalledWith(writtenPath(), sample.path.inputFull);

		expect(vi.mocked(rename).mock.invocationCallOrder[0]).toBeGreaterThan(
			vi.mocked(pipeline).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
	});

	test('Removes the temporary file and rethrows when the pipeline fails, leaving the target untouched', async () => {
		// 1. A source failing mid-way used to leave a truncated file under the final name; now nothing reaches the
		//    target and the partial file is gone, which is what the object stores do
		const error = new Error('source failed');
		vi.mocked(pipeline).mockRejectedValueOnce(error);

		await expect(driver.write(sample.path.input, sample.stream)).rejects.toBe(error);

		expect(unlink).toHaveBeenCalledWith(writtenPath());
		expect(rename).not.toHaveBeenCalled();
	});

	test('A failing cleanup does not hide the write error', async () => {
		// 1. The caller needs the reason the write failed; a temporary file that could not be removed is secondary
		const error = new Error('source failed');
		vi.mocked(pipeline).mockRejectedValueOnce(error);
		vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));

		await expect(driver.write(sample.path.input, sample.stream)).rejects.toBe(error);
	});

	test('Removes the temporary file and rethrows when the rename fails', async () => {
		// 1. A cross-device target, a directory in the way or `EPERM` used to rethrow with the `<name>.<hex>.tmp` file
		//    left on disk forever, because the rename sat outside the cleanup `try`
		const error = Object.assign(new Error('invalid cross-device link'), { code: 'EXDEV' });
		vi.mocked(rename).mockRejectedValueOnce(error);

		await expect(driver.write(sample.path.input, sample.stream)).rejects.toBe(error);

		expect(unlink).toHaveBeenCalledWith(writtenPath());
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

	test('Skips the temporary staging files of a concurrent write', async () => {
		// 1. `write()` stages its bytes in a `<name>.<random>.tmp` sibling; a listing running while the write is in
		//    flight would otherwise yield a path that vanishes the moment the write publishes its rename
		vi.mocked(relative).mockImplementation((_, x) => x);

		vi.mocked(opendir).mockResolvedValue(
			(function* () {
				yield { name: 'file.png.0f1e2d3c4b5a.tmp', isFile: () => true, isDirectory: () => false };
				yield { name: 'file.png', isFile: () => true, isDirectory: () => false };
			})() as unknown as Dir,
		);

		const output = [];

		for await (const filename of driver['listGenerator']('')) {
			output.push(filename);
		}

		expect(output).toStrictEqual(['file.png']);
	});

	test('Yields forward slashes whatever the platform separator is', async () => {
		// 1. `relative` reports platform separators — a backslash on Windows — while the contract mandates forward
		//    slashes, so the yielded path is normalised
		vi.mocked(relative).mockImplementation((_, x) => x.replaceAll('/', '\\'));

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

	test('Finishes without items when the prefix directory does not exist', async () => {
		// 1. The root is only created on the first write, so a listing of a fresh location must end empty rather than
		//    reject, as it does on an object store with no keys under the prefix
		vi.mocked(opendir).mockRejectedValueOnce(Object.assign(new Error('no such directory'), { code: 'ENOENT' }));

		const iterator = driver['listGenerator'](`${randDirectoryPath()}/`);

		await expect(iterator.next()).resolves.toStrictEqual({ done: true, value: undefined });
	});

	test('Finishes without items when a segment of the prefix is a file', async () => {
		// 1. ENOTDIR means the prefix runs through a file, so no file can sit under it
		vi.mocked(opendir).mockRejectedValueOnce(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }));

		const iterator = driver['listGenerator'](`${randDirectoryPath()}/`);

		await expect(iterator.next()).resolves.toStrictEqual({ done: true, value: undefined });
	});

	test('Rethrows any other error from opening the directory', async () => {
		// 1. A permission error says nothing about which files are there, so an empty listing would be a wrong answer
		const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
		vi.mocked(opendir).mockRejectedValueOnce(error);

		const iterator = driver['listGenerator'](`${randDirectoryPath()}/`);

		await expect(iterator.next()).rejects.toBe(error);
	});
});

describe('#tusExtensions', () => {
	test('Advertises creation, termination and expiration', () => {
		// 1. Only the extensions the chunked-upload methods back: a chunk is written at its offset without a
		//    verification step, and chunks of several uploads cannot be joined into one
		expect(driver.tusExtensions).toStrictEqual(['creation', 'termination', 'expiration']);
	});
});

describe('#createChunkedUpload', () => {
	beforeEach(() => {
		// 1. `ensureDir` is stubbed so the tests can assert it was asked for the right directory
		driver['ensureDir'] = vi.fn();
	});

	test('Creates the empty target file under the resolved path', async () => {
		const mockDirname = randDirectoryPath();
		vi.mocked(dirname).mockReturnValueOnce(mockDirname);

		const context = { size: sample.file.size, metadata: {} };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(dirname).toHaveBeenCalledWith(sample.path.inputFull);
		expect(driver['ensureDir']).toHaveBeenCalledWith(mockDirname);
		expect(writeFile).toHaveBeenCalledWith(sample.path.inputFull, '');
		expect(result).toBe(context);
	});
});

describe('#writeChunk', () => {
	let mockTarget: PassThrough;

	let mockCreateWriteStream: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// 1. A real pass-through stands in for the file stream, so the real `stream.pipeline` the driver uses flows
		//    bytes through and the offset math is what is under test
		mockTarget = new PassThrough();
		mockCreateWriteStream = vi.fn().mockReturnValue(mockTarget);

		vi.mocked(open).mockResolvedValue({
			createWriteStream: mockCreateWriteStream,
		} as unknown as Awaited<ReturnType<typeof open>>);
	});

	test('Writes the chunk into the file at the given offset', async () => {
		const received: Buffer[] = [];
		mockTarget.on('data', (chunk: Buffer) => received.push(chunk));

		const result = await driver.writeChunk(
			sample.path.input,
			Readable.from([Buffer.from('abc'), Buffer.from('def')]),
			5,
			{ size: 11, metadata: {} },
		);

		// 1. The file is opened for writing without truncating and the stream starts at the offset, so the chunk
		//    lands at its place while the bytes before it stay intact
		expect(open).toHaveBeenCalledWith(sample.path.inputFull, 'r+');
		expect(mockCreateWriteStream).toHaveBeenCalledWith({ start: 5 });

		// 2. The returned offset is the given one plus every byte that flowed through, and the bytes arrive as sent
		expect(result).toBe(11);
		expect(Buffer.concat(received).toString()).toBe('abcdef');
	});

	test('Rejects with the file and offset when the pipeline fails', async () => {
		// 1. The TUS server maps any rejection to a generic failure and the client resumes from its last confirmed
		//    offset, so the error must carry a readable reason naming the file and the offset
		vi.mocked(useLogger).mockReturnValue({ warn: vi.fn() } as any);

		const source = new PassThrough();

		const result = driver.writeChunk(sample.path.input, source, 7, { size: 11, metadata: {} });

		source.write('abc');
		source.destroy(new Error('source died'));

		await expect(result).rejects.toThrowError(
			`Local storage failed to write a chunk of "${sample.path.input}" at offset 7`,
		);
	});

	test.each([['ENOENT'], ['ENOTDIR']] as const)(
		'Maps a missing upload file (%s) to the kit error, keeping the cause',
		async (code) => {
			// 1. `writeChunk` requires the upload's file to exist — `createChunkedUpload` makes it — so a missing file
			//    means the upload is unknown; a raw file system error would not say that, the kit's "not found" does
			const cause = Object.assign(new Error('no such file or directory'), { code });

			vi.mocked(open).mockRejectedValue(cause);

			const failure: unknown = await driver
				.writeChunk(sample.path.input, Readable.from([Buffer.from('abc')]), 0, { size: 3, metadata: {} })
				.catch((error: unknown) => error);

			expect(failure).toBeInstanceOf(StorageFileNotFoundError);
			expect(failure).toMatchObject({ extensions: { filepath: sample.path.input } });
			expect((failure as { cause?: unknown }).cause).toBe(cause);
		},
	);

	test('Rethrows any other file open error unchanged', async () => {
		// 1. Only the errors that prove the path cannot exist mean "missing"; anything else says nothing about the
		//    upload and is rethrown, the way `read` and `stat` treat it
		const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });

		vi.mocked(open).mockRejectedValue(failure);

		await expect(
			driver.writeChunk(sample.path.input, Readable.from([Buffer.from('abc')]), 0, { size: 3, metadata: {} }),
		).rejects.toBe(failure);
	});
});

describe('#finishChunkedUpload', () => {
	test('Resolves without touching the file', async () => {
		// 1. Every chunk was written in place at its offset, so the file is already complete once the last chunk lands
		await expect(
			driver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).resolves.toBeUndefined();

		expect(writeFile).not.toHaveBeenCalled();
	});
});

describe('#deleteChunkedUpload', () => {
	test('Removes the partially written file', async () => {
		// 1. Chunks are written straight into the final file, so removing that file discards the whole upload
		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(unlink).toHaveBeenCalledWith(sample.path.inputFull);
	});
});
