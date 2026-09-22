/**
 * Tests of `storage-driver-cloudinary/lib/driver`.
 */
import { Blob, Buffer } from 'node:buffer';
import type { Hash } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
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
	randUuid,
	randWord,
} from '@ngneat/falso';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, normalizePath } from '@novastarter/utils';
import type { Response } from 'undici';
import { fetch, FormData } from 'undici';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { IMAGE_EXTENSIONS, MINIMUM_CHUNK_SIZE, VIDEO_EXTENSIONS } from './constants.js';
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
 * Real `Buffer` and `Blob`, kept for the suites that push actual bytes through the buffering code while `node:buffer`
 * stays mocked for the rest.
 */
const { Buffer: BufferActual, Blob: BlobActual } = await vi.importActual<typeof import('node:buffer')>('node:buffer');

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
	uploadId: string;
	formUrlEncoded: string;
};

/**
 * Driver under test, created without a root and with every path/signature helper stubbed to the fixture values, so
 * each public method can be checked against the helpers it is expected to call.
 */
let driver: StorageDriverCloudinary;

/**
 * Put the real `Buffer` statics and `Blob` behind the automock for the current test, so the buffering code cuts and
 * wraps real bytes instead of `undefined`.
 */
const useActualBuffers = () => {
	// 1. Only the statics the driver calls are restored; buffers made by `BufferActual` carry the real instance
	//    methods already
	vi.mocked(Buffer.alloc).mockImplementation(BufferActual.alloc);
	vi.mocked(Buffer.concat).mockImplementation(BufferActual.concat);
	vi.mocked(Buffer.isBuffer).mockImplementation(BufferActual.isBuffer);

	// 2. A real `Blob` reports the real `size`, which is what the `Content-Range` assertions read
	vi.mocked(Blob).mockImplementation(function (parts) {
		return new BlobActual(parts);
	});
};

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
		uploadId: randUuid(),
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

	// 4. Signatures, auth, time and the upload id are fixed to fixture values; their own suites re-create the driver
	//    to test them
	driver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);
	driver['getParameterSignature'] = vi.fn().mockReturnValue(sample.parameterSignature);
	driver['getBasicAuth'] = vi.fn().mockReturnValue(sample.basicAuth);
	driver['getFullSignature'] = vi.fn().mockReturnValue(sample.fullSignature);
	driver['getTimestamp'] = vi.fn().mockReturnValue(sample.timestamp);
	driver['getUploadId'] = vi.fn().mockReturnValue(sample.uploadId);
	vi.spyOn(toFormUrlEncodedUtil, 'toFormUrlEncoded').mockReturnValue(sample.formUrlEncoded);
});

afterEach(() => {
	// 1. Every automocked module and spy goes back to its blank state, so an implementation set by one test cannot
	//    leak into the next
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
		// 1. The key is sent with every signed request, so it has to survive construction unchanged
		expect(driver['apiKey']).toBe(sample.config.apiKey);
	});

	test('Saves apiSecret internally', () => {
		// 1. The secret feeds every signature, so it has to survive construction unchanged
		expect(driver['apiSecret']).toBe(sample.config.apiSecret);
	});

	test('Saves cloudName internally', () => {
		// 1. The cloud name scopes every API and delivery URL, so it has to survive construction unchanged
		expect(driver['cloudName']).toBe(sample.config.cloudName);
	});

	test('Saves accessMode internally', () => {
		// 1. The access mode is stored on every uploaded asset, so it has to survive construction unchanged
		expect(driver['accessMode']).toBe(sample.config.accessMode);
	});

	test('Defaults root to empty string', () => {
		// 1. An empty root leaves no leading slash for Cloudinary to take as part of a public id
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		// 1. The root goes through `confinePath`, so `.` and `..` segments resolve the way they do in every key
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);

		new StorageDriverCloudinary({
			cloudName: sample.config.cloudName,
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			root: sample.config.root,
			accessMode: sample.config.accessMode,
		});

		expect(confinePath).toHaveBeenCalledWith(sample.config.root);
	});
});

describe('#fullPath', () => {
	test('Returns normalized joined path', () => {
		// 1. Both helpers are auto-mocked; fixed return values let the assertions check the wiring, not real path logic
		vi.mocked(joinPath).mockReturnValue(sample.path.inputFull);
		vi.mocked(confinePath).mockReturnValue(sample.path.input);
		vi.mocked(normalizePath).mockReturnValue(sample.path.inputFull);

		const driver = new StorageDriverCloudinary({
			cloudName: sample.config.cloudName,
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			accessMode: sample.config.accessMode,
		});

		driver['root'] = sample.config.root;

		// 2. `joinPath` must get root and confined path in that order, and its result is the public id
		const result = driver['fullPath'](sample.path.input);

		// 3. The caller path is confined first, so a leading `..` is dropped before the root is joined
		expect(confinePath).toHaveBeenCalledWith(sample.path.input);
		expect(joinPath).toHaveBeenCalledWith(sample.config.root, sample.path.input);
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
		// 1. Cloudinary excludes these four keys from signing; signing them would produce a digest the API never
		//    matches, so only the rest of the payload may reach the signature string
		const payload = {
			...mockPayload,
			file: randText(),
			cloud_name: randCloudName(),
			resource_type: randWord(),
			api_key: randAlphaNumeric({ length: 15 }).join(''),
		};

		driver['getFullSignature'](payload);

		expect(toSignatureStringUtil.toSignatureString).toHaveBeenCalledWith(mockPayload);
	});

	test('Creates sha256 hash', () => {
		// 1. SHA-256 is the digest Cloudinary verifies request signatures against
		driver['getFullSignature'](mockPayload);
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates sha256 hash with signature payload + api secret', () => {
		// 1. Cloudinary's scheme appends the secret to the parameter string rather than using it as an HMAC key
		const mockSignatureString = randWord();
		vi.mocked(toSignatureStringUtil.toSignatureString).mockReturnValue(mockSignatureString);

		driver['getFullSignature'](mockPayload);

		expect(mockCreateHash.update).toHaveBeenCalledWith(mockSignatureString + sample.config.apiSecret);
	});

	test('Preserves spaces in asset_folder when updating the hash', () => {
		// 1. The real serializer runs here: Cloudinary signs raw values, so a space must not become `+` or `%20`
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
		// 1. The `signature` parameter is compared as a hex string on Cloudinary's side
		driver['getFullSignature'](mockPayload);
		expect(mockCreateHash.digest).toHaveBeenCalledWith('hex');
	});

	test('Returns digested hash', () => {
		// 1. The digest is passed through untouched; any wrapping would break the comparison
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
		// 1. Delivery URL signatures use the same SHA-256 digest as request signatures
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates hash with passed filepath + apiSecret', () => {
		// 1. A delivery signature covers the asset path and the secret, nothing else
		expect(mockCreateHash.update).toHaveBeenCalledWith(sample.path.input + sample.config.apiSecret);
	});

	test('Digests hash to base64url', () => {
		// 1. The signature sits in a URL segment, so the URL-safe alphabet is required
		expect(mockCreateHash.digest).toHaveBeenCalledWith('base64url');
	});

	test('Returns first 8 characters of base64 sha hash wrapped in Cloudinary prefix/suffix', () => {
		// 1. Cloudinary compares exactly `s--` plus the first eight characters plus `--`
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
		// 1. The frozen clock must not outlive the suite, or later suites would see a stale time
		vi.useRealTimers();
	});

	test('Returns unix timestamp for current time', () => {
		// 1. The timestamp is a signed parameter, so it is produced as text straight away
		expect(driver['getTimestamp']()).toBe(String(mockDate.getTime()));
	});
});

describe('#getUploadId', () => {
	beforeEach(() => {
		// 1. A fresh driver, since the shared one has `getUploadId` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});
	});

	test('Returns a random UUID rather than the timestamp', () => {
		// 1. Two uploads started in the same millisecond share a timestamp; a UUID is what keeps their chunks apart
		//    on Cloudinary's side
		const mockUuid = randUuid() as ReturnType<typeof randomUUID>;
		vi.mocked(randomUUID).mockReturnValue(mockUuid);

		expect(driver['getUploadId']()).toBe(mockUuid);
		expect(randomUUID).toHaveBeenCalledOnce();
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
		// 1. Every listed extension must route to the image endpoints; one miss would upload that format as `raw`
		IMAGE_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('image');
		});
	});

	test('Returns "video" for extensions contained in the video extensions constant', () => {
		// 1. Every listed extension must route to the video endpoints; one miss would upload that format as `raw`
		VIDEO_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('video');
		});
	});

	test('Returns "raw" for unknown / other extensions', () => {
		// 1. `extname` is mocked to `undefined` here, which is as unknown as an extension gets; `raw` is the fallback
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
		// 1. The resource type decides whether the extension stays, so it must be derived from the very same path
		driver['getPublicId'](sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Returns original file path if type is raw', () => {
		// 1. Cloudinary stores no format for raw assets, so the extension is the only way the name survives
		vi.mocked(parse).mockReturnValueOnce({ base: sample.path.input } as ParsedPath);
		driver['getResourceType'] = vi.fn().mockReturnValue('raw');
		const publicId = driver['getPublicId'](sample.path.input);
		expect(publicId).toBe(sample.path.input);
	});

	test('Parsed base path if other type', () => {
		// 1. Cloudinary appends the format to image and video ids itself; keeping it would yield `name.png.png`
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
		// 1. The admin API takes the key/secret pair as plain basic-auth credentials, base64 encoded
		driver['getBasicAuth']();

		expect(Buffer.from).toHaveBeenCalledWith(`${sample.config.apiKey}:${sample.config.apiSecret}`);
		expect(mockToString).toHaveBeenCalledWith('base64');
	});

	test(`Returns 'Basic <base64>'`, () => {
		// 1. The header value needs the scheme prefix, or the request is rejected as anonymous
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

	test('Throws StorageFileNotFoundError when Cloudinary answers 404', async () => {
		// 1. A 404 is the error every backend shares; any other error status stays the generic one
		mockResponse.status = 404;
		mockResponse.body = { cancel: vi.fn(async () => {}) } as unknown as ReadableStream;

		await expect(driver.read(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Gets resource type for extension of given filepath', async () => {
		// 1. The resource type is a segment of the delivery URL, so it is derived from the caller path
		await driver.read(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Creates signature for full filepath', async () => {
		// 1. The delivery signature covers the path with the root, which is what Cloudinary serves the asset under
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['getParameterSignature']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls fetch with generated URL', async () => {
		// 1. Signature, resource type and full path must land in the segments Cloudinary expects them in
		await driver.read(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET' },
		);
	});

	test('Adds optional Range header for start', async () => {
		// 1. An open end asks for everything from `start` on
		await driver.read(sample.path.input, { range: { start: sample.range.start, end: undefined } });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=${sample.range.start}-` } },
		);
	});

	test('Adds optional Range header for end', async () => {
		// 1. An omitted start is `0`: `bytes=-N` would mean the last N bytes instead of the first ones
		await driver.read(sample.path.input, { range: { start: undefined, end: sample.range.end } });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=0-${sample.range.end}` } },
		);
	});

	test('Adds optional Range header for start and end', async () => {
		// 1. Both bounds go out as-is; HTTP ranges are inclusive like the driver's
		await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull}`,
			{ method: 'GET', headers: { Range: `bytes=${sample.range.start}-${sample.range.end}` } },
		);
	});

	test('Throws error when response has status >= 400', async () => {
		// 1. An error status carries no asset to stream; the caller gets the path, not a broken stream
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver.read(sample.path.input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});

	test('Throws error when response has no readable body', async () => {
		// 1. A 2xx without a body cannot be turned into a stream either, so it is reported the same way
		mockResponse.body = null;

		try {
			await driver.read(sample.path.input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});

	test('Cancels the response body it never reads', async () => {
		// 1. An unread response body holds its connection open, so the error path must release it
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.read(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns readable stream from web stream', async () => {
		// 1. `fetch` yields a Web stream; the storage layer works with Node readables, so the body is converted
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
		// 1. The lookup addresses the asset under the root, so the caller path is resolved first
		await driver.stat(sample.path.input);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for given filepath', async () => {
		// 1. The `explicit` endpoint is per resource type, derived from the full path
		await driver.stat(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for given filepath', async () => {
		// 1. The public id is derived from the full path, so the root folder becomes part of it
		await driver.stat(sample.path.input);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Creates signature for body parameters', async () => {
		// 1. The signature covers exactly the parameters sent, with the public id as `folder/id` without a leading
		//    slash; any extra or missing key would produce a digest Cloudinary never matches
		await driver.stat(sample.path.input);

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			type: 'upload',
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
		});
	});

	test('Creates form url encoded body ', async () => {
		// 1. The body carries the signed parameters plus the signature itself
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
		// 1. `explicit` is a POST with a form body; the content type is what makes Cloudinary parse the parameters
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

	test('Cancels the response body it never reads', async () => {
		// 1. An unread response body holds its connection open, so the error path must release it
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.stat(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns size/modified from bytes/created_at from Cloudinary', async () => {
		// 1. Cloudinary reports no modification time, so `created_at` stands in for it
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
		// 1. The same lookup `stat` uses answers the question; the caller path is passed on untouched
		await driver.exists(sample.path.input);
		expect(requestResource).toHaveBeenCalledWith(sample.path.input);
	});

	test('Returns true if the resource is returned', async () => {
		// 1. A record for the id means the asset is there
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(true);
	});

	test('Returns false if the resource is not found', async () => {
		// 1. Only a 404 is a definite "no"
		requestResource.mockResolvedValue({ status: 404, body: { cancel } });
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(false);
	});

	test.each([401, 420, 503])('Throws if the lookup failed with a %i', async (status) => {
		// 1. Reporting a failed lookup as "the file isn't there" makes callers act on a wrong answer, for example by
		//    serving a permission error for a file that does exist
		requestResource.mockResolvedValue({ status, body: { cancel } });

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(
			new Error(`Couldn't check whether file "${sample.path.input}" exists (${status})`),
		);
	});

	test('Cancels the response body it never reads', async () => {
		// 1. An unread response body holds its connection open; `exists` reads only the status
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
		// 1. The source is addressed under the root, so its caller path is resolved first
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
	});

	test('Gets full path for dest', async () => {
		// 1. The destination stays under the same root, so it is resolved the same way
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);
	});

	test('Gets public id for src', async () => {
		// 1. `rename` addresses the source by its public id, derived from the full path
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets public id for dest', async () => {
		// 1. The new id follows the same derivation, or an image would end up with its extension in the id
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Gets folder path for src', async () => {
		// 1. The folder is prefixed to the id, so it is taken from the full path
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets folder path for dest', async () => {
		// 1. A move into another folder is expressed through the id prefix, so the destination folder is needed too
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Creates signature for body parameters', async () => {
		// 1. The signature covers exactly the parameters sent; both ids are `folder/id`
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			from_public_id: joinPathActual(sample.path.srcFolder, sample.publicId.src),
			to_public_id: joinPathActual(sample.path.destFolder, sample.publicId.dest),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
		});
	});

	test('Creates form url encoded body ', async () => {
		// 1. The body carries the signed parameters plus the signature itself
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
		// 1. `rename` is per resource type, which comes from the source: a rename cannot change an asset's type
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
		// 1. A rejected rename is reported with the source path, so the caller knows which move failed
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver.move(sample.path.src, sample.path.dest);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`Can't move file "${sample.path.src}": Unknown`);
		}
	});

	test(`Defaults to Unknown if error object doesn't contain message`, async () => {
		// 1. An error object without a message still needs a readable reason
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
		// 1. Cloudinary explains a rejected rename in the body; that explanation is what the caller needs
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
		// 1. Cloudinary has no server-side copy, so the source is read back through this process
		await driver.copy(sample.path.src, sample.path.dest);
		expect(driver.read).toHaveBeenCalledWith(sample.path.src);
	});

	test('Calls write with dest path and read stream', async () => {
		// 1. The stream read from the source is what gets uploaded under the destination path
		await driver.copy(sample.path.src, sample.path.dest);
		expect(driver.write).toHaveBeenCalledWith(sample.path.dest, sample.stream);
	});
});

describe('#write', () => {
	/**
	 * Build a stream that emits the given chunks and ends, so `write` sees a complete upload straight away.
	 *
	 * @param chunks - Chunks to emit; random short buffers when omitted.
	 * @returns The ended stream.
	 */
	const createStream = (chunks?: Buffer[]): Readable => {
		// 1. Random short chunks are enough for the tests that only care about the helpers `write` calls; they stay
		//    far below the chunk size, so everything goes out as the single last request
		return Readable.from(
			chunks ?? randUnique({ length: randNumber({ min: 1, max: 10 }) }).map((str: string) => BufferActual.from(str)),
		);
	};

	/**
	 * Offset, size and declared total of every chunk `write` queued, in request order.
	 *
	 * @returns One `[offset, size, total]` triple per `uploadChunk` call.
	 */
	const chunkRanges = () =>
		vi
			.mocked(driver['uploadChunk'])
			.mock.calls.map(([options]) => [options.bytesOffset, options.blob.size, options.bytesTotal]);

	beforeEach(() => {
		// 1. The chunk upload is stubbed, so these tests cover the buffering and queueing rather than the HTTP call;
		//    its arguments are read from `mock.calls`, because vitest cannot print a `Blob` in an assertion diff and
		//    fails with a `TypeError` instead of a readable mismatch
		driver['uploadChunk'] = vi.fn();

		// 2. Real bytes flow through the buffering loop here, so the cuts and the chunk sizes are what gets checked
		useActualBuffers();
	});

	test('Gets full path for input', async () => {
		// 1. The asset is placed under the root, so the caller path is resolved first
		await driver.write(sample.path.input, createStream());

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', async () => {
		// 1. The upload endpoint is per resource type, derived from the full path
		await driver.write(sample.path.input, createStream());

		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Constructs signature from correct upload parameters', async () => {
		// 1. A folder becomes the asset folder and the id prefix; the signature must cover exactly these parameters
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
		// 1. A small stream fits one buffer, so a single request carries the whole file together with its total
		await driver.write(sample.path.input, createStream());

		expect(driver['uploadChunk']).toHaveBeenCalledOnce();
	});

	test('Sends every chunk under the upload id of this write', async () => {
		// 1. The id is a header rather than a signed parameter, so it has to reach `uploadChunk` on its own
		await driver.write(sample.path.input, createStream());

		expect(vi.mocked(driver['uploadChunk']).mock.calls[0]![0].uploadId).toBe(sample.uploadId);
	});

	test('Queues chunk upload each time chunks add up to more than 5.5 MB of data', async () => {
		// 1. Nothing is sent for the first 3 MB; with the second 3 MB the buffer passes 5.5 MB and the first 5.5 MB go
		//    out as one chunk with an unknown total; the 0.5 MB left plus the final 1 MB are the last request, which
		//    carries the real total
		await driver.write(
			sample.path.input,
			createStream([BufferActual.alloc(3e6), BufferActual.alloc(3e6), BufferActual.alloc(1e6)]),
		);

		expect(chunkRanges()).toStrictEqual([
			[0, 5.5e6, -1],
			[5.5e6, 1.5e6, 7e6],
		]);
	});

	test('Keeps a buffer of exactly the chunk size for the last request', async () => {
		// 1. A source that adds up to exactly 5.5 MB is one chunk; sending it early with an unknown total would leave
		//    Cloudinary waiting for a final request that never comes
		await driver.write(sample.path.input, createStream([BufferActual.alloc(5.5e6)]));

		expect(chunkRanges()).toStrictEqual([[0, 5.5e6, 5.5e6]]);
	});

	test('Sends every byte when one source chunk is larger than the upload chunk size', async () => {
		// 1. A 12 MB source chunk holds two full upload chunks: the loop used to compute the space left in the buffer,
		//    which went negative on the second cut and silently dropped bytes
		await driver.write(sample.path.input, createStream([BufferActual.alloc(12e6, 1), BufferActual.alloc(12e6, 2)]));

		// 2. 24 MB is four full chunks and a 2 MB tail, with contiguous offsets and the total only on the last one
		expect(chunkRanges()).toStrictEqual([
			[0, 5.5e6, -1],
			[5.5e6, 5.5e6, -1],
			[11e6, 5.5e6, -1],
			[16.5e6, 5.5e6, -1],
			[22e6, 2e6, 24e6],
		]);

		// 3. The chunk spanning both sources must switch from the first fill value to the second at byte 12 MB
		const bytes = new Uint8Array(await vi.mocked(driver['uploadChunk']).mock.calls[2]![0].blob.arrayBuffer());

		expect(bytes[0]).toBe(1);
		expect(bytes[1e6 - 1]).toBe(1);
		expect(bytes[1e6]).toBe(2);
		expect(bytes[bytes.length - 1]).toBe(2);
	});

	test('Reports the first failed chunk with the path once every request has settled', async () => {
		// 1. The failure is remembered rather than thrown mid-stream, so the queue drains before the caller hears
		//    about it and no request is left dangling
		const cause = new Error(randText());
		vi.mocked(driver['uploadChunk']).mockRejectedValueOnce(cause);

		await expect(driver.write(sample.path.input, createStream())).rejects.toThrowError(
			`Can't upload file "${sample.path.input}": ${cause.message}`,
		);
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
			uploadId: sample.uploadId,
			parameters: {
				timestamp: sample.timestamp,
			},
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
		vi.mocked(FormData).mockReturnValue(mockFormData as unknown as FormData);
	});

	test('Creates FormData object', async () => {
		// 1. A chunk goes out as multipart form data, one body per request
		await driver['uploadChunk'](input);

		expect(FormData).toHaveBeenCalledOnce();
		expect(FormData).toHaveBeenCalledWith();
	});

	test('Saves all passed parameters to form data', async () => {
		// 1. Every signed parameter travels as a text field next to the file, or the signature would not verify
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
		// 1. `Content-Range` places the chunk and `X-Unique-Upload-Id` joins it with the others; the range end is
		//    inclusive, hence the `- 1`
		await driver['uploadChunk'](input);

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/${sample.resourceType}/upload`,
			{
				method: 'POST',
				body: mockFormData,
				headers: {
					'X-Unique-Upload-Id': sample.uploadId,
					'Content-Range': `bytes ${input.bytesOffset}-${input.bytesOffset + input.blob.size - 1}/${input.bytesTotal}`,
				},
			},
		);
	});

	test('Ties the chunk to the upload by the upload id, not by the timestamp', async () => {
		// 1. Two uploads started in the same millisecond share a timestamp, so it cannot be what joins the chunks
		await driver['uploadChunk'](input);

		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const headers = init!.headers as Record<string, string>;

		expect(headers['X-Unique-Upload-Id']).toBe(sample.uploadId);
		expect(headers['X-Unique-Upload-Id']).not.toBe(sample.timestamp);
	});

	test('Throws an error when the response statusCode is >=400', async () => {
		// 1. A rejected chunk is reported; `write` wraps the message with the path later
		mockResponse.status = randNumber({ min: 400, max: 599 });

		try {
			await driver['uploadChunk'](input);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('Unknown');
		}
	});

	test('Defaults to Unknown if Cloudinary API response error message is not known', async () => {
		// 1. An error object without a message still needs a readable reason
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
		// 1. Cloudinary explains a rejected chunk in the body; that explanation is what the caller needs
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

		// 2. Cloudinary answers a destroy with 200, `result: 'ok'` or `'not found'` alike; a missing asset is deleted
		vi.mocked(fetch).mockResolvedValue({ status: 200, json: async () => ({ result: 'ok' }) } as unknown as Response);

		// 3. One call up front; every test below asserts a different helper or request the call made
		await driver.delete(sample.path.input);
	});

	test('Throws when Cloudinary answers with an error status instead of resolving', async () => {
		// 1. A rotated secret, a rate limit or a 5xx is a delete that did not happen, and must not read as one
		vi.mocked(fetch).mockResolvedValue({
			status: 401,
			json: async () => ({ error: { message: 'Invalid Signature' } }),
		} as unknown as Response);

		await expect(driver.delete(sample.path.input)).rejects.toThrow(
			`Error deleting file "${sample.path.input}": Invalid Signature`,
		);
	});

	test('Gets full path', () => {
		// 1. The asset is addressed under the root, so the caller path is resolved first
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', () => {
		// 1. `destroy` is per resource type, derived from the full path
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for full path', () => {
		// 1. The public id is derived from the full path, so the root folder becomes part of it
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Generates signature for delete parameters', () => {
		// 1. `resource_type` is sent as a parameter as well; it sits on the signing denylist, so the signature stays
		//    valid either way
		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			resource_type: sample.resourceType,
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
		});
	});

	test('Calls fetch with correct parameters', async () => {
		// 1. The body carries the signed parameters plus the signature, as a form-encoded POST to `destroy`
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
		// 1. The prefix is searched under the root, so the caller prefix is resolved first
		await driver.list(sample.path.input).next();
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Fetches search api results', async () => {
		// 1. The search API takes a wildcard expression and basic auth; an empty cursor asks for the first page. The
		//    expression is encoded so a prefix with `&`, `#` or `+` cannot break the query
		await driver.list(sample.path.input).next();

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?expression=${encodeURIComponent(
				sample.path.inputFull,
			)}*&next_cursor=`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Yields resource public IDs from response', async () => {
		// 1. Without a root, raw public ids are the paths callers pass in, so they come back untouched
		const output: string[] = [];

		for await (const path of driver.list(sample.path.input)) {
			output.push(path);
		}

		expect(output.length).toBe(mockResponseBody.resources.length);
		expect(output).toStrictEqual(mockFilePaths);
	});

	test('Keeps calling fetch as long as a next_cursor is returned', async () => {
		// 1. The search API pages with a cursor; the second request must carry the cursor the first one returned
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
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?expression=${encodeURIComponent(
				sample.path.inputFull,
			)}*&next_cursor=${mockNextCursor}`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Throws error if search api fails', async () => {
		// 1. A failed search is reported with the prefix, so the caller knows which listing failed
		mockResponse.status = randNumber({ min: 400, max: 599 });

		await expect(driver.list(sample.path.input).next()).rejects.toThrow(
			`Can't list for prefix "${sample.path.input}": Unknown`,
		);
	});

	test('Defaults to Unknown error if the error response does not contain a message', async () => {
		// 1. An error object without a message still needs a readable reason
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		await expect(driver.list(sample.path.input).next()).rejects.toThrow(
			`Can't list for prefix "${sample.path.input}": Unknown`,
		);
	});

	test('Provides Cloudinary error message, read from the body once', async () => {
		// 1. A body can be read once: a second `json()` on a real response rejects with "Body is unusable"
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randText() };

		mockResponse.json
			.mockReset()
			.mockResolvedValueOnce(mockResponseBody)
			.mockRejectedValue(new TypeError('Body is unusable: Body has already been read'));

		await expect(driver.list(sample.path.input).next()).rejects.toThrow(
			`Can't list for prefix "${sample.path.input}": ${mockResponseBody.error.message}`,
		);
	});
});

describe('#tusExtensions', () => {
	test('Advertises creation, termination and expiration', () => {
		// 1. Exactly the extensions the chunked-upload methods back; the TUS server refuses a client feature that is
		//    not on this list
		expect(driver.tusExtensions).toStrictEqual(['creation', 'termination', 'expiration']);
	});
});

describe('#createChunkedUpload', () => {
	test('Records the signing timestamp and the upload id in the context metadata', async () => {
		// 1. The context is what the TUS server hands back on every later call, so both values must survive in it
		const context = { size: randNumber(), metadata: {} };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result).toBe(context);
		expect(result.metadata).toStrictEqual({ timestamp: sample.timestamp, uploadId: sample.uploadId });
	});

	test('Creates the metadata map when the client sent none', async () => {
		// 1. A POST without `Upload-Metadata` leaves the map undefined; recording the upload state must not throw a
		//    TypeError, which would leave the TUS server without the context it persists
		const context = { size: randNumber(), metadata: undefined };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result.metadata).toStrictEqual({ timestamp: sample.timestamp, uploadId: sample.uploadId });
	});
});

describe('#writeChunk', () => {
	let context: { size: number; metadata: Record<string, string | null> };

	beforeEach(() => {
		// 1. The chunk upload is stubbed, so these tests cover what the context contributes to the request
		driver['uploadChunk'] = vi.fn();

		// 2. Real bytes flow through the buffering here, so the offsets and totals are what gets checked
		useActualBuffers();

		// 3. A context as `createChunkedUpload` leaves it, for a 6-byte upload
		context = { size: 6, metadata: { timestamp: sample.timestamp, uploadId: sample.uploadId } };
	});

	test('Sends the chunk under the upload id and timestamp the upload started with', async () => {
		// 1. A later chunk must join the same Cloudinary upload and verify against the same signature, so neither
		//    value may be regenerated per chunk
		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.uploadId).toBe(sample.uploadId);
		expect(options.parameters['timestamp']).toBe(sample.timestamp);
		expect(driver['getUploadId']).not.toHaveBeenCalled();
	});

	test('Falls back to the timestamp as upload id for an upload started without one', async () => {
		// 1. Chunks of an upload created before the id was recorded went out under the timestamp; switching ids
		//    halfway would strand them
		delete context.metadata['uploadId'];

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		expect(vi.mocked(driver['uploadChunk']).mock.calls[0]![0].uploadId).toBe(sample.timestamp);
	});

	test('Copes with a context that carries no metadata map', async () => {
		// 1. A context handed over without its map must not crash on reading the upload state; a missing session is the
		//    API's error to report once the request goes out, not a TypeError of the driver
		const bareContext = { size: 6, metadata: undefined };

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, bareContext);

		expect(bareContext.metadata).toStrictEqual({});
	});

	test('Refuses a chunk above the configured size', async () => {
		// 1. The TUS server agrees to send at most the configured size per request; a larger chunk is refused before it
		//    is sent, so Cloudinary never assembles bytes the upload did not agree to carry
		const tusDriver = new StorageDriverCloudinary({
			cloudName: sample.config.cloudName,
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			accessMode: sample.config.accessMode,
			tus: { enabled: true, chunkSize: MINIMUM_CHUNK_SIZE },
		});

		tusDriver['fullPath'] = vi.fn().mockReturnValue(sample.path.inputFull);
		tusDriver['getFolderPath'] = vi.fn().mockReturnValue('');
		tusDriver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);
		tusDriver['getPublicId'] = vi.fn().mockReturnValue(sample.publicId.input);
		tusDriver['getTimestamp'] = vi.fn().mockReturnValue(sample.timestamp);
		tusDriver['getFullSignature'] = vi.fn().mockReturnValue(sample.fullSignature);
		tusDriver['uploadChunk'] = vi.fn();

		const oversized = BufferActual.alloc(MINIMUM_CHUNK_SIZE + 1);

		await expect(tusDriver.writeChunk(sample.path.input, Readable.from([oversized]), 0, context)).rejects.toThrow(
			`The chunk of ${MINIMUM_CHUNK_SIZE + 1} bytes exceeds the chunk size limit of ${MINIMUM_CHUNK_SIZE} bytes`,
		);

		expect(vi.mocked(tusDriver['uploadChunk'])).not.toHaveBeenCalled();
	});

	test('Declares an unknown total until the chunk that completes the upload', async () => {
		// 1. Cloudinary assembles the asset on the request that carries the real total, so an earlier chunk must
		//    send `-1` and the last one the declared size; the returned offset is what the TUS server stores
		expect(await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context)).toBe(3);
		expect(await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('def')]), 3, context)).toBe(6);

		expect(
			vi
				.mocked(driver['uploadChunk'])
				.mock.calls.map(([options]) => [options.bytesOffset, options.blob.size, options.bytesTotal]),
		).toStrictEqual([
			[0, 3, -1],
			[3, 3, 6],
		]);
	});
});
