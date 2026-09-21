/**
 * Tests of `storage-driver-cloudinary/lib/driver`.
 */
import { Blob, Buffer } from 'node:buffer';
import type { Hash } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { ParsedPath } from 'node:path';
import { extname, parse } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import {
	rand,
	randAlphaNumeric,
	randGitBranch as randCloudName,
	randDirectoryPath,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randGitCommitSha as randSha,
	randText,
	randGitShortSha as randUnique,
	randWord,
} from '@ngneat/falso';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { joinPath, normalizePath } from '@novastarter/utils';
import type { Response } from 'undici';
import { fetch, FormData } from 'undici';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './constants.js';
import type { StorageDriverCloudinaryConfig } from './driver.js';
import { StorageDriverCloudinary } from './driver.js';
import * as toFormUrlEncodedUtil from './to-form-url-encoded.js';
import * as toSignatureStringUtil from './to-signature-string.js';

vi.mock('@novastarter/utils/node');
vi.mock('@novastarter/utils');
vi.mock('node:path');
vi.mock('node:buffer');
vi.mock('node:crypto');
vi.mock('undici');

/**
 * Real `joinPath`, kept for the suites that need genuine path joining while `@novastarter/utils` stays mocked for the
 * rest.
 */
const { joinPath: joinPathActual } = await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	config: { [Key in keyof StorageDriverCloudinaryConfig]-?: NonNullable<StorageDriverCloudinaryConfig[Key]> };
	path: {
		input: string;
		inputFull: string;
		inputFolder: string;
		src: string;
		srcFull: string;
		srcFolder: string;
		dest: string;
		destFull: string;
		destFolder: string;
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
	resourceType: 'image' | 'video' | 'raw';
	publicId: {
		input: string;
		src: string;
		dest: string;
	};
	parameterSignature: string;
	fullSignature: string;
	basicAuth: string;
	timestamp: string;
	formUrlEncoded: string;
};

/**
 * Driver under test, created without a root and with every path/signature helper stubbed to the fixture values, so
 * each public method can be checked against the helpers it is expected to call.
 */
let driver: StorageDriverCloudinary;

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			root: randDirectoryPath(),
			apiKey: randNumber({ length: 15 }).join(''),
			apiSecret: randAlphaNumeric({ length: 27 }).join(''),
			cloudName: randCloudName(),
			accessMode: rand(['public', 'authenticated']),
			tus: { enabled: false },
		},
		path: {
			input: randUnique() + randFilePath(),
			inputFull: randUnique() + randFilePath(),
			inputFolder: randUnique() + randFilePath(),
			src: randUnique() + randFilePath(),
			srcFull: randUnique() + randFilePath(),
			srcFolder: randUnique() + randFilePath(),
			dest: randUnique() + randFilePath(),
			destFull: randUnique() + randFilePath(),
			destFolder: randUnique() + randFilePath(),
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
		resourceType: rand(['image', 'video', 'raw']),
		publicId: {
			input: randUnique() + randFilePath(),
			src: randUnique() + randFilePath(),
			dest: randUnique() + randFilePath(),
		},
		parameterSignature: `s--${randAlphaNumeric({ length: 8 }).join('')}--`,
		fullSignature: randSha(),
		basicAuth: `Basic ${randSha()}`,
		timestamp: String(randPastDate().getTime()),
		formUrlEncoded: randAlphaNumeric({ length: 30 }).join(''),
	};

	// 2. No root, so the path helpers below fully control which full path every input resolves to
	driver = new StorageDriverCloudinary({
		cloudName: sample.config.cloudName,
		apiKey: sample.config.apiKey,
		apiSecret: sample.config.apiSecret,
		accessMode: sample.config.accessMode,
	});

	// 3. Map each fixture path to its full/folder/public-id counterpart, so tests can assert the exact values that
	//    flow from one helper into the next without depending on real path logic
	driver['fullPath'] = vi.fn().mockImplementation((input) => {
		if (input === sample.path.src) return sample.path.srcFull;
		if (input === sample.path.dest) return sample.path.destFull;
		if (input === sample.path.input) return sample.path.inputFull;

		return '';
	});

	driver['getFolderPath'] = vi.fn().mockImplementation((input) => {
		if (input === sample.path.src) return sample.path.srcFolder;
		if (input === sample.path.dest) return sample.path.destFolder;
		if (input === sample.path.input) return sample.path.inputFolder;
		if (input === sample.path.srcFull) return sample.path.srcFolder;
		if (input === sample.path.destFull) return sample.path.destFolder;
		if (input === sample.path.inputFull) return sample.path.inputFolder;

		return '';
	});

	driver['getPublicId'] = vi.fn().mockImplementation((input) => {
		if (input === sample.path.srcFull) return sample.publicId.src;
		if (input === sample.path.destFull) return sample.publicId.dest;
		if (input === sample.path.inputFull) return sample.publicId.input;

		return '';
	});

	// 4. Signatures, auth and time are fixed to fixture values; their own suites re-create the driver to test them
	driver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);
	driver['getParameterSignature'] = vi.fn().mockReturnValue(sample.parameterSignature);
	driver['getBasicAuth'] = vi.fn().mockReturnValue(sample.basicAuth);
	driver['getFullSignature'] = vi.fn().mockReturnValue(sample.fullSignature);
	driver['getTimestamp'] = vi.fn().mockReturnValue(sample.timestamp);
	vi.spyOn(toFormUrlEncodedUtil, 'toFormUrlEncoded').mockReturnValue(sample.formUrlEncoded);
});

afterEach(() => {
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test.each([
		['cloudName', 'a "cloudName"'],
		['apiKey', 'an "apiKey"'],
		['apiSecret', 'an "apiSecret"'],
	] as const)('Refuses a missing %s', (option, expected) => {
		// 1. Every request is signed with the credentials; the driver names the missing option instead of a 401 later
		expect(
			() =>
				new StorageDriverCloudinary({
					cloudName: sample.config.cloudName,
					apiKey: sample.config.apiKey,
					apiSecret: sample.config.apiSecret,
					accessMode: sample.config.accessMode,
					[option]: '',
				}),
		).toThrowError(`The cloudinary storage driver needs ${expected}`);
	});

	test('Refuses a chunk size below the Cloudinary minimum when resumable uploads are on', () => {
		// 1. Cloudinary rejects chunks under 5 MB, so a smaller TUS chunk would fail on every upload
		expect(
			() =>
				new StorageDriverCloudinary({
					cloudName: sample.config.cloudName,
					apiKey: sample.config.apiKey,
					apiSecret: sample.config.apiSecret,
					accessMode: sample.config.accessMode,
					tus: { enabled: true, chunkSize: 1000 },
				}),
		).toThrowErrorMatchingInlineSnapshot(`[Error: The cloudinary storage driver got a "tus.chunkSize" below 5 MB]`);
	});

	test('Saves apiKey internally', () => {
		expect(driver['apiKey']).toBe(sample.config.apiKey);
	});

	test('Saves apiSecret internally', () => {
		expect(driver['apiSecret']).toBe(sample.config.apiSecret);
	});

	test('Saves cloudName internally', () => {
		expect(driver['cloudName']).toBe(sample.config.cloudName);
	});

	test('Saves accessMode internally', () => {
		expect(driver['accessMode']).toBe(sample.config.accessMode);
	});

	test('Defaults root to empty string', () => {
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);

		new StorageDriverCloudinary({
			cloudName: sample.config.cloudName,
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			root: sample.config.root,
			accessMode: sample.config.accessMode,
		});

		expect(normalizePath).toHaveBeenCalledWith(sample.config.root, { removeLeading: true });
	});
});

describe('#fullPath', () => {
	test('Returns normalized joined path', () => {
		// 1. Both helpers are auto-mocked; fixed return values let the assertions check the wiring, not real path logic
		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);

		const driver = new StorageDriverCloudinary({
			cloudName: sample.config.cloudName,
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			accessMode: sample.config.accessMode,
		});

		driver['root'] = sample.config.root;

		// 2. `joinPath` must get root and path in that order, and its result must lose its leading slash
		const result = driver['fullPath'](sample.path.input);

		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
		expect(normalizePath).toHaveBeenCalledWith(sample.path.inputFull, { removeLeading: true });
		expect(result).toBe(sample.path.inputFull);
	});
});

describe('#getFullSignature', () => {
	let mockPayload: Record<string, string>;

	let mockCreateHash: {
		update: Mock;
		digest: Mock;
	};

	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getFullSignature` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// 2. A chainable hash stub, so `update` and `digest` can be asserted separately from the real digest
		mockCreateHash = {
			update: vi.fn().mockReturnThis(),
			digest: vi.fn().mockReturnThis(),
		};

		vi.mocked(createHash).mockReturnValue(mockCreateHash as unknown as Hash);
		vi.spyOn(toSignatureStringUtil, 'toSignatureString');

		// 3. A random payload of matching key/value counts stands in for real request parameters
		const randLength = randNumber({ min: 1, max: 10 });

		const props = randWord({ length: randLength });
		const values = randWord({ length: randLength });

		mockPayload = Object.fromEntries(props.map((key, index) => [key, values[index]!]));
	});

	test('Ignores Cloudinary denylist of keys', () => {
		const payload = {
			...mockPayload,

			// Ignored properties:
			file: randText(),
			cloud_name: randCloudName(),
			resource_type: randWord(),
			api_key: randAlphaNumeric({ length: 15 }).join(''),
		};

		driver['getFullSignature'](payload);

		expect(toSignatureStringUtil.toSignatureString).toHaveBeenCalledWith(mockPayload);
	});

	test('Creates sha256 hash', () => {
		driver['getFullSignature'](mockPayload);
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates sha256 hash with signature payload + api secret', () => {
		const mockSignatureString = randWord();
		vi.mocked(toSignatureStringUtil.toSignatureString).mockReturnValue(mockSignatureString);

		driver['getFullSignature'](mockPayload);

		expect(mockCreateHash.update).toHaveBeenCalledWith(mockSignatureString + sample.config.apiSecret);
	});

	test('Preserves spaces in asset_folder when updating the hash', () => {
		vi.mocked(toSignatureStringUtil.toSignatureString).mockRestore();

		driver['getFullSignature']({
			asset_folder: 'my folder',
			timestamp: sample.timestamp,
		});

		expect(mockCreateHash.update).toHaveBeenCalledWith(
			`asset_folder=my folder&timestamp=${sample.timestamp}${sample.config.apiSecret}`,
		);
	});

	test('Digests hash as hex', () => {
		driver['getFullSignature'](mockPayload);
		expect(mockCreateHash.digest).toHaveBeenCalledWith('hex');
	});

	test('Returns digested hash', () => {
		const mockHash = randSha();
		mockCreateHash.digest.mockReturnValue(mockHash);

		const hash = driver['getFullSignature'](mockPayload);

		expect(hash).toBe(mockHash);
	});
});

describe('#getParameterSignature', () => {
	let mockHash: string;
	let result: string;

	let mockCreateHash: {
		update: Mock;
		digest: Mock;
	};

	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getParameterSignature` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// 2. The digest is fixed to a known value, so the returned signature can be checked character by character
		mockHash = randSha();

		mockCreateHash = {
			update: vi.fn().mockReturnThis(),
			digest: vi.fn().mockReturnValue(mockHash),
		};

		vi.mocked(createHash).mockReturnValue(mockCreateHash as unknown as Hash);

		// 3. One call up front; every test below asserts a different aspect of the same result
		result = driver['getParameterSignature'](sample.path.input);
	});

	test('Creates sha256 hash', () => {
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates hash with passed filepath + apiSecret', () => {
		expect(mockCreateHash.update).toHaveBeenCalledWith(sample.path.input + sample.config.apiSecret);
	});

	test('Digests hash to base64url', () => {
		expect(mockCreateHash.digest).toHaveBeenCalledWith('base64url');
	});

	test('Returns first 8 characters of base64 sha hash wrapped in Cloudinary prefix/suffix', () => {
		expect(result).toBe(`s--${mockHash.substring(0, 8)}--`);
	});
});

describe('#getTimestamp', () => {
	let mockDate: Date;

	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getTimestamp` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// 2. Freeze the clock, so the expected timestamp is known before the call
		mockDate = randPastDate();
		vi.useFakeTimers();
		vi.setSystemTime(mockDate);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('Returns unix timestamp for current time', () => {
		expect(driver['getTimestamp']()).toBe(String(mockDate.getTime()));
	});
});

describe('#getResourceType', () => {
	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getResourceType` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});
	});

	test('Returns "image" for extensions contained in the image extensions constant', () => {
		IMAGE_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('image');
		});
	});

	test('Returns "video" for extensions contained in the video extensions constant', () => {
		VIDEO_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('video');
		});
	});

	test('Returns "raw" for unknown / other extensions', () => {
		randWord({ length: 5 }).forEach((filepath) => expect(driver['getResourceType'](filepath)).toBe('raw'));
	});
});

describe('#getPublicId', () => {
	let mockParsedPath: string;

	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getPublicId` stubbed out; the resource type stays stubbed so
		//    each test can pick the branch it exercises
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		driver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);

		// 2. `parse` is mocked, so the `name` it reports is what the image/video branch must return
		mockParsedPath = randDirectoryPath();
		vi.mocked(parse).mockReturnValue({ name: mockParsedPath } as ParsedPath);
	});

	test('Gets resourceType for given filepath', () => {
		driver['getPublicId'](sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Returns original file path if type is raw', () => {
		vi.mocked(parse).mockReturnValueOnce({ base: sample.path.input } as ParsedPath);
		driver['getResourceType'] = vi.fn().mockReturnValue('raw');
		const publicId = driver['getPublicId'](sample.path.input);
		expect(publicId).toBe(sample.path.input);
	});

	test('Parsed base path if other type', () => {
		driver['getResourceType'] = vi.fn().mockReturnValue(rand(['image', 'video']));
		const publicId = driver['getPublicId'](sample.path.input);
		expect(publicId).toBe(mockParsedPath);
	});
});

describe('#getBasicAuth', () => {
	let mockToString: Mock;

	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getBasicAuth` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// 2. `Buffer.from` is spied on so the base64 step can be asserted without computing a real encoding
		mockToString = vi.fn();

		vi.spyOn(Buffer, 'from').mockReturnValue({ toString: mockToString } as unknown as Buffer<ArrayBuffer>);
	});

	test('Creates base64 hash of key:secret', () => {
		driver['getBasicAuth']();

		expect(Buffer.from).toHaveBeenCalledWith(`${sample.config.apiKey}:${sample.config.apiSecret}`);
		expect(mockToString).toHaveBeenCalledWith('base64');
	});

	test(`Returns 'Basic <base64>'`, () => {
		const mockBase64 = randSha();
		mockToString.mockReturnValue(mockBase64);

		const result = driver['getBasicAuth']();

		expect(result).toBe(`Basic ${mockBase64}`);
	});
});

describe('#read', () => {
	let mockResponse: {
		status: number;
		body: ReadableStream | null;
	};

	beforeEach(() => {
		// 1. A successful streaming response by default; tests flip the status or body to cover the failure paths
		mockResponse = {
			status: 200,
			body: new ReadableStream(),
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as Response);
		vi.spyOn(Readable, 'fromWeb').mockReturnValue(sample.stream);
	});

	test('Gets resource type for extension of given filepath', async () => {
		await driver.read(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Creates signature for full filepath', async () => {
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['getParameterSignature']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls fetch with generated URL', async () => {
		await driver.read(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET' },
		);
	});

	test('Adds optional Range header for start', async () => {
		await driver.read(sample.path.input, { range: { start: sample.range.start, end: undefined } });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=${sample.range.start}-` } },
		);
	});

	test('Adds optional Range header for end', async () => {
		await driver.read(sample.path.input, { range: { start: undefined, end: sample.range.end } });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=-${sample.range.end}` } },
		);
	});

	test('Adds optional Range header for start and end', async () => {
		await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=${sample.range.start}-${sample.range.end}` } },
		);
	});

	test('Throws error when response has status >= 400', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver.read(sample.path.input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});

	test('Throws error when response has no readable body', async () => {
		mockResponse.body = null;

		try {
			await driver.read(sample.path.input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});

	/** An unread response body holds its connection open */
	test('Cancels the response body it never reads', async () => {
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.read(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns readable stream from web stream', async () => {
		const stream = await driver.read(sample.path.input);
		expect(Readable.fromWeb).toHaveBeenCalledWith(mockResponse.body);
		expect(stream).toBe(sample.stream);
	});
});

describe('#stat', () => {
	let mockResponse: { json: Mock; status: number };

	let mockResponseBody: {
		bytes: number;
		created_at: string;
	};

	beforeEach(() => {
		// 1. The record Cloudinary would return for the fixture file, in the field names of its API
		mockResponseBody = {
			bytes: sample.file.size,
			created_at: sample.file.modified.toISOString(),
		};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		// 2. Real joining here, because the public id assertions rebuild `folder/id` the same way the driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for given filepath', async () => {
		await driver.stat(sample.path.input);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for given filepath', async () => {
		await driver.stat(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for given filepath', async () => {
		await driver.stat(sample.path.input);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Creates signature for body parameters', async () => {
		await driver.stat(sample.path.input);

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			type: 'upload',
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
		});
	});

	test('Creates form url encoded body ', async () => {
		await driver.stat(sample.path.input);

		expect(toFormUrlEncodedUtil.toFormUrlEncoded).toHaveBeenCalledWith({
			type: 'upload',
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
			signature: sample.fullSignature,
		});
	});

	test('Fetches URL with url encoded body', async () => {
		await driver.stat(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/${sample.resourceType}/explicit`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				},
				body: sample.formUrlEncoded,
			},
		);
	});

	test('Throws error when status is >400', async () => {
		// 1. Any error status but 404 says nothing about the asset, so it surfaces as a plain error with the status
		mockResponse.status = randNumber({ min: 405, max: 599 });

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}" (${mockResponse.status})`,
		);
	});

	test('Maps a 404 to the kit error', async () => {
		// 1. Only a 404 is a definite "missing"; it becomes the error every backend shares
		mockResponse.status = 404;

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input } });
	});

	/** An unread response body holds its connection open */
	test('Cancels the response body it never reads', async () => {
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.stat(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns size/modified from bytes/created_at from Cloudinary', async () => {
		const result = await driver.stat(sample.path.input);

		expect(result).toStrictEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});
	});
});

describe('#exists', () => {
	let requestResource: Mock;
	let cancel: Mock;

	beforeEach(() => {
		// 1. Stub the lookup itself: `exists` only interprets the status, and `cancel` is tracked to prove the
		//    unread body is released
		cancel = vi.fn().mockResolvedValue(undefined);
		requestResource = vi.fn().mockResolvedValue({ status: 200, body: { cancel } });
		driver['requestResource'] = requestResource;
	});

	test('Requests the resource for the given filepath', async () => {
		await driver.exists(sample.path.input);
		expect(requestResource).toHaveBeenCalledWith(sample.path.input);
	});

	test('Returns true if the resource is returned', async () => {
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(true);
	});

	test('Returns false if the resource is not found', async () => {
		requestResource.mockResolvedValue({ status: 404, body: { cancel } });
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(false);
	});

	/**
	 * Reporting a failed lookup as "the file isn't there" makes callers act on a wrong answer, for example by serving
	 * a permission error for a file that does exist.
	 */
	test.each([401, 420, 503])('Throws if the lookup failed with a %i', async (status) => {
		requestResource.mockResolvedValue({ status, body: { cancel } });

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(
			new Error(`Couldn't check whether file "${sample.path.input}" exists (${status})`),
		);
	});

	/** An unread response body holds its connection open */
	test('Cancels the response body it never reads', async () => {
		await driver.exists(sample.path.input);
		expect(cancel).toHaveBeenCalled();
	});
});

describe('#move', () => {
	let mockResponse: { json: Mock; status: number };

	let mockResponseBody: {
		error?: { message?: string };
	};

	beforeEach(() => {
		// 1. Real joining here, because the `from`/`to` public id assertions rebuild `folder/id` the same way the
		//    driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		// 2. An empty success body by default; the error tests fill in `error.message` to check what is surfaced
		mockResponseBody = {};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for src', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
	});

	test('Gets full path for dest', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);
	});

	test('Gets public id for src', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets public id for dest', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Gets folder path for src', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets folder path for dest', async () => {
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Creates signature for body parameters', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			from_public_id: joinPathActual(sample.path.srcFolder, sample.publicId.src),
			to_public_id: joinPathActual(sample.path.destFolder, sample.publicId.dest),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
		});
	});

	test('Creates form url encoded body ', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		expect(toFormUrlEncodedUtil.toFormUrlEncoded).toHaveBeenCalledWith({
			from_public_id: joinPathActual(sample.path.srcFolder, sample.publicId.src),
			to_public_id: joinPathActual(sample.path.destFolder, sample.publicId.dest),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
			signature: sample.fullSignature,
		});
	});

	test('Fetches URL with url encoded body', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/${sample.resourceType}/rename`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				},
				body: sample.formUrlEncoded,
			},
		);
	});

	test('Throws error if status is >400', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver.move(sample.path.src, sample.path.dest);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't move file "${sample.path.src}": Unknown`);
		}
	});

	test(`Defaults to Unknown if error object doesn't contain message`, async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		try {
			await driver.move(sample.path.src, sample.path.dest);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't move file "${sample.path.src}": Unknown`);
		}
	});

	test(`Renders message if returned by Cloudinary`, async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randText() };

		try {
			await driver.move(sample.path.src, sample.path.dest);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't move file "${sample.path.src}": ${mockResponseBody.error.message}`);
		}
	});
});

describe('#copy', () => {
	beforeEach(() => {
		// 1. `copy` is only a read piped into a write, so both are stubbed and the wiring between them is asserted
		driver.read = vi.fn().mockResolvedValue(sample.stream);
		driver.write = vi.fn();
	});

	test('Calls read with input path', async () => {
		await driver.copy(sample.path.src, sample.path.dest);
		expect(driver.read).toHaveBeenCalledWith(sample.path.src);
	});

	test('Calls write with dest path and read stream', async () => {
		await driver.copy(sample.path.src, sample.path.dest);
		expect(driver.write).toHaveBeenCalledWith(sample.path.dest, sample.stream);
	});
});

describe('#write', () => {
	/**
	 * Build an already-ended stream that emits the given chunks, so `write` sees a complete upload straight away.
	 *
	 * @param chunks - Chunks to emit; random short buffers when omitted.
	 * @returns The ended stream.
	 */
	const createStream = (chunks?: Buffer[]): PassThrough => {
		// 1. Random chunks are enough for the tests that only care about the helpers `write` calls
		chunks = chunks ?? randUnique({ length: randNumber({ min: 1, max: 10 }) }).map((str: string) => Buffer.from(str));

		const stream = new PassThrough();

		// 2. Emit synchronously and end, so the async iteration inside `write` finishes without waiting on I/O
		for (const chunk of chunks!) {
			stream.emit('data', chunk);
		}

		stream.end();
		stream.destroy();

		return stream;
	};

	// NOTE: Blob's can't be converted to Strings by `vitest`, so any `.toEqual()` or `.hasBeenCalledWith` uses
	// against the params of the function call will error with a
	// `TypeError: Cannot read properties of undefined (reading 'toString')`

	beforeEach(() => {
		// 1. The chunk upload is stubbed, so these tests cover the buffering and queueing rather than the HTTP call
		driver['uploadChunk'] = vi.fn();
	});

	test('Gets full path for input', async () => {
		await driver.write(sample.path.input, createStream());

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', async () => {
		await driver.write(sample.path.input, createStream());

		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Constructs signature from correct upload parameters', async () => {
		await driver.write(sample.path.input, createStream());

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			type: 'upload',
			access_mode: sample.config.accessMode,
			public_id: sample.publicId.input,
			asset_folder: sample.path.inputFolder,
			use_asset_folder_as_public_id_prefix: 'true',
		});
	});

	test('Queues upload once stream has buffered', async () => {
		await driver.write(sample.path.input, createStream());

		expect(driver['uploadChunk']).toHaveBeenCalledOnce();
	});

	test('Queues chunk upload each time chunks add up to at least 5.5MB of data', async () => {
		// 1. Nothing is sent for the first 3 MB; together with the second 3 MB the buffer crosses 5.5 MB and goes
		//    out as one chunk; the final 1 MB is sent as its own last request
		const chunk1 = Buffer.alloc(3e6);
		const chunk2 = Buffer.alloc(3e6);
		const chunk3 = Buffer.alloc(1e6);

		const chunks = [chunk1, chunk2, chunk3];
		await driver.write(sample.path.input, createStream(chunks));

		expect(driver['uploadChunk']).toHaveBeenCalledOnce();
		expect(driver['uploadChunk']).toHaveBeenCalledOnce();
	});
});

describe('#uploadChunk', () => {
	let mockResponse: { json: Mock; status: number };

	let mockResponseBody: {
		error?: { message?: string };
	};

	let mockFormData: {
		set: Mock;
	};

	let input: Parameters<(typeof driver)['uploadChunk']>[0];

	beforeEach(() => {
		// 1. An empty success body by default; the error tests fill in `error.message` to check what is surfaced
		mockResponseBody = {};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		// 2. `FormData` is mocked, so the fields the driver sets can be asserted without inspecting a real body
		mockFormData = {
			set: vi.fn(),
		};

		// 3. A minimal chunk: only `size` matters for the `Content-Range` header, so the blob is a plain stub
		input = {
			resourceType: sample.resourceType,
			blob: { size: randNumber({ min: 0, max: 1500 }) } as Blob,
			bytesOffset: randNumber({ min: 0, max: 500 }),
			bytesTotal: randNumber(),
			parameters: {
				timestamp: sample.timestamp,
			},
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
		vi.mocked(FormData).mockReturnValue(mockFormData as unknown as FormData);
	});

	test('Creates FormData object', async () => {
		await driver['uploadChunk'](input);

		expect(FormData).toHaveBeenCalledOnce();
		expect(FormData).toHaveBeenCalledWith();
	});

	test('Saves all passed parameters to form data', async () => {
		const keys = randUnique({ length: randNumber({ min: 1, max: 10 }) });
		const values = randUnique({ length: randNumber({ min: 1, max: 10 }) });

		keys.forEach((key, index) => {
			input.parameters[key] = values[index]!;
		});

		await driver['uploadChunk'](input);

		keys.forEach((key, index) => {
			expect(mockFormData.set).toHaveBeenCalledWith(key, values[index]!);
		});
	});

	test('Calls fetch with formData an range header', async () => {
		await driver['uploadChunk'](input);

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/${sample.resourceType}/upload`,
			{
				method: 'POST',
				body: mockFormData,
				headers: {
					'X-Unique-Upload-Id': sample.timestamp,
					'Content-Range': `bytes ${input.bytesOffset}-${input.bytesOffset + input.blob.size - 1}/${input.bytesTotal}`,
				},
			},
		);
	});

	test('Throws an error when the response statusCode is >=400', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver['uploadChunk'](input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('Unknown');
		}
	});

	test('Defaults to Unknown if Cloudinary API response error message is not known', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		try {
			await driver['uploadChunk'](input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('Unknown');
		}
	});

	test('Sets error message to Cloudinary return message', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randWord() };

		try {
			await driver['uploadChunk'](input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(mockResponseBody.error.message);
		}
	});
});

describe('#delete', () => {
	beforeEach(async () => {
		// 1. Real joining here, because the public id assertion rebuilds `folder/id` the same way the driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		// 2. One call up front; every test below asserts a different helper or request the call made
		await driver.delete(sample.path.input);
	});

	test('Gets full path', () => {
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', () => {
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for full path', () => {
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Generates signature for delete parameters', () => {
		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			resource_type: sample.resourceType,
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
		});
	});

	test('Calls fetch with correct parameters', async () => {
		expect(toFormUrlEncodedUtil.toFormUrlEncoded).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			resource_type: sample.resourceType,
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			signature: sample.fullSignature,
		});

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/${sample.resourceType}/destroy`,
			{
				method: 'POST',
				body: sample.formUrlEncoded,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				},
			},
		);
	});
});

describe('#list', () => {
	let mockResponse: {
		status: number;
		json: Mock;
	};

	let mockFilePaths: string[];

	let mockResponseBody: {
		resources: { public_id: string }[];
		error?: {
			message?: string;
		};
		next_cursor?: string;
	};

	beforeEach(() => {
		// 1. A single page of raw resources (no `resource_type`), so the yielded paths equal the public ids as-is
		mockFilePaths = randFilePath({ length: randNumber({ min: 1, max: 10 }) });

		mockResponseBody = {
			resources: mockFilePaths.map((filepath) => ({
				public_id: filepath,
			})),
		};

		// 2. No `next_cursor` by default, so the listing stops after one request unless a test adds one
		mockResponse = {
			status: 200,
			json: vi.fn().mockResolvedValue(mockResponseBody),
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for prefix', async () => {
		await driver.list(sample.path.input).next();
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Fetches search api results', async () => {
		await driver.list(sample.path.input).next();

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?expression=${sample.path.inputFull}*&next_cursor=`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Yields resource public IDs from response', async () => {
		const output: string[] = [];

		for await (const path of driver.list(sample.path.input)) {
			output.push(path);
		}

		expect(output.length).toBe(mockResponseBody.resources.length);
		expect(output).toStrictEqual(mockFilePaths);
	});

	test('Keeps calling fetch as long as a next_cursor is returned', async () => {
		const mockNextCursor = randSha();

		mockResponse.json.mockResolvedValueOnce({
			...mockResponseBody,
			next_cursor: mockNextCursor,
		});

		const output: string[] = [];

		for await (const path of driver.list(sample.path.input)) {
			output.push(path);
		}

		expect(fetch).toHaveBeenCalledTimes(2);

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?expression=${sample.path.inputFull}*&next_cursor=${mockNextCursor}`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Throws error if search api fails', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver.list(sample.path.input).next();
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't list for prefix "${sample.path.input}": Unknown`);
		}
	});

	test('Defaults to Unknown error if the error response does not contain a message', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		try {
			await driver.list(sample.path.input).next();
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't list for prefix "${sample.path.input}": Unknown`);
		}
	});

	test('Provides Cloudinary error message', async () => {
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randText() };

		try {
			await driver.list(sample.path.input).next();
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't list for prefix "${sample.path.input}": ${mockResponseBody.error.message}`);
		}
	});
});
