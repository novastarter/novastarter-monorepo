/**
 * Tests of `storage-driver-cloudinary/lib/driver`.
 */
import { Blob, Buffer } from 'node:buffer';
import type { Hash } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
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
import { HitRateLimitError, InvalidConfigError, InvalidPayloadError, ProviderCallError } from '@novastarter/errors';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { confinePath, joinPath, normalizePath, withTimeout } from '@novastarter/utils';
import type { Response } from 'undici';
import { fetch, FormData } from 'undici';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { IMAGE_EXTENSIONS, MINIMUM_CHUNK_SIZE, VIDEO_EXTENSIONS } from './constants.js';
import type { StorageDriverCloudinaryConfig } from './driver.js';
import { StorageDriverCloudinary } from './driver.js';
import * as toFormUrlEncodedUtil from './to-form-url-encoded.js';
import * as toSignatureStringUtil from './to-signature-string.js';

vi.mock('@novastarter/utils');
vi.mock('node:path');
vi.mock('node:buffer');
vi.mock('node:crypto');
vi.mock('undici');

/**
 * Real `joinPath`, kept for the suites that need genuine path joining while `@novastarter/utils` stays mocked for the
 * rest.
 */
const {
	confinePath: confinePathActual,
	joinPath: joinPathActual,
	withTimeout: withTimeoutActual,
} = await vi.importActual<typeof import('@novastarter/utils')>('@novastarter/utils');

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
	// Only the statics the driver calls are restored; buffers made by `BufferActual` carry the real instance
	// methods already
	vi.mocked(Buffer.alloc).mockImplementation(BufferActual.alloc);
	vi.mocked(Buffer.concat).mockImplementation(BufferActual.concat);
	vi.mocked(Buffer.isBuffer).mockImplementation(BufferActual.isBuffer);

	// A real `Blob` reports the real `size`, which is what the `Content-Range` assertions read
	vi.mocked(Blob).mockImplementation(function (parts) {
		return new BlobActual(parts);
	});
};

beforeEach(() => {
	// Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
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

	// No root, so the path helpers below fully control which full path every input resolves to
	driver = new StorageDriverCloudinary({
		cloudName: sample.config.cloudName,
		apiKey: sample.config.apiKey,
		apiSecret: sample.config.apiSecret,
		accessMode: sample.config.accessMode,
	});

	// Map each fixture path to its full/folder/public-id counterpart, so tests can assert the exact values that
	// flow from one helper into the next without depending on real path logic
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

	// Signatures, auth, time and the upload id are fixed to fixture values; their own suites re-create the driver
	// to test them
	driver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);
	driver['getParameterSignature'] = vi.fn().mockReturnValue(sample.parameterSignature);
	driver['getBasicAuth'] = vi.fn().mockReturnValue(sample.basicAuth);
	driver['getFullSignature'] = vi.fn().mockReturnValue(sample.fullSignature);
	driver['getTimestamp'] = vi.fn().mockReturnValue(sample.timestamp);
	driver['getUploadId'] = vi.fn().mockReturnValue(sample.uploadId);
	vi.spyOn(toFormUrlEncodedUtil, 'toFormUrlEncoded').mockReturnValue(sample.formUrlEncoded);
});

afterEach(() => {
	// Every automocked module and spy goes back to its blank state, so an implementation set by one test cannot
	// leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test.each([
		['cloudName', 'a "cloudName"'],
		['apiKey', 'an "apiKey"'],
		['apiSecret', 'an "apiSecret"'],
	] as const)('Refuses a missing %s', (option, expected) => {
		// Every request is signed with the credentials; the driver names the missing option instead of a 401 later
		expect(
			() =>
				new StorageDriverCloudinary({
					cloudName: sample.config.cloudName,
					apiKey: sample.config.apiKey,
					apiSecret: sample.config.apiSecret,
					accessMode: sample.config.accessMode,
					[option]: '',
				}),
		).toThrowError(new InvalidConfigError({ reason: `The cloudinary storage driver needs ${expected}` }));
	});

	test('Refuses a chunk size below the Cloudinary minimum when resumable uploads are on', () => {
		// Cloudinary rejects chunks under 5 MB, so a smaller TUS chunk would fail on every upload
		expect(
			() =>
				new StorageDriverCloudinary({
					cloudName: sample.config.cloudName,
					apiKey: sample.config.apiKey,
					apiSecret: sample.config.apiSecret,
					accessMode: sample.config.accessMode,
					tus: { enabled: true, chunkSize: 1000 },
				}),
		).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The cloudinary storage driver needs a "tus.chunkSize" of at least 5 MB.]`,
		);
	});

	test.each([[0], [Number.NaN]])(
		'Refuses a chunk size of %s that comparisons never catch when resumable uploads are on',
		(chunkSize) => {
			// A zero or NaN size slips through every truthiness or threshold comparison: kept as the per-chunk bound,
			// a zero refuses every chunk that arrives and NaN silently disables the limit `writeChunk` enforces
			expect(
				() =>
					new StorageDriverCloudinary({
						cloudName: sample.config.cloudName,
						apiKey: sample.config.apiKey,
						apiSecret: sample.config.apiSecret,
						accessMode: sample.config.accessMode,
						tus: { enabled: true, chunkSize },
					}),
			).toThrowError(InvalidConfigError);
		},
	);

	test('Saves apiKey internally', () => {
		// The key is sent with every signed request, so it has to survive construction unchanged
		expect(driver['apiKey']).toBe(sample.config.apiKey);
	});

	test('Saves apiSecret internally', () => {
		// The secret feeds every signature, so it has to survive construction unchanged
		expect(driver['apiSecret']).toBe(sample.config.apiSecret);
	});

	test('Saves cloudName internally', () => {
		// The cloud name scopes every API and delivery URL, so it has to survive construction unchanged
		expect(driver['cloudName']).toBe(sample.config.cloudName);
	});

	test('Saves accessMode internally', () => {
		// The access mode is stored on every uploaded asset, so it has to survive construction unchanged
		expect(driver['accessMode']).toBe(sample.config.accessMode);
	});

	test('Defaults root to empty string', () => {
		// An empty root leaves no leading slash for Cloudinary to take as part of a public id
		expect(driver['root']).toBe('');
	});

	test('Normalizes config path when root is given', () => {
		// The root goes through `confinePath`, so `.` and `..` segments resolve the way they do in every key
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
		// Both helpers are auto-mocked; fixed return values let the assertions check the wiring, not real path logic
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

		// `joinPath` must get root and confined path in that order, and its result is the public id
		const result = driver['fullPath'](sample.path.input);

		// The caller path is confined first, so a leading `..` is dropped before the root is joined
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
		// A fresh driver, since the shared one has `getFullSignature` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// A chainable hash stub, so `update` and `digest` can be asserted separately from the real digest
		mockCreateHash = {
			update: vi.fn().mockReturnThis(),
			digest: vi.fn().mockReturnThis(),
		};

		vi.mocked(createHash).mockReturnValue(mockCreateHash as unknown as Hash);
		vi.spyOn(toSignatureStringUtil, 'toSignatureString');

		// A random payload of matching key/value counts stands in for real request parameters
		const randLength = randNumber({ min: 1, max: 10 });

		const props = randWord({ length: randLength });
		const values = randWord({ length: randLength });

		mockPayload = Object.fromEntries(props.map((key, index) => [key, values[index]!]));
	});

	test('Ignores Cloudinary denylist of keys', () => {
		// Cloudinary excludes these four keys from signing; signing them would produce a digest the API never
		// matches, so only the rest of the payload may reach the signature string
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
		// SHA-256 is the digest Cloudinary verifies request signatures against
		driver['getFullSignature'](mockPayload);
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates sha256 hash with signature payload + api secret', () => {
		// Cloudinary's scheme appends the secret to the parameter string rather than using it as an HMAC key
		const mockSignatureString = randWord();
		vi.mocked(toSignatureStringUtil.toSignatureString).mockReturnValue(mockSignatureString);

		driver['getFullSignature'](mockPayload);

		expect(mockCreateHash.update).toHaveBeenCalledWith(mockSignatureString + sample.config.apiSecret);
	});

	test('Preserves spaces in asset_folder when updating the hash', () => {
		// The real serializer runs here: Cloudinary signs raw values, so a space must not become `+` or `%20`
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
		// The `signature` parameter is compared as a hex string on Cloudinary's side
		driver['getFullSignature'](mockPayload);
		expect(mockCreateHash.digest).toHaveBeenCalledWith('hex');
	});

	test('Returns digested hash', () => {
		// The digest is passed through untouched; any wrapping would break the comparison
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
		// A fresh driver, since the shared one has `getParameterSignature` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// The digest is fixed to a known value, so the returned signature can be checked character by character
		mockHash = randSha();

		mockCreateHash = {
			update: vi.fn().mockReturnThis(),
			digest: vi.fn().mockReturnValue(mockHash),
		};

		vi.mocked(createHash).mockReturnValue(mockCreateHash as unknown as Hash);

		// One call up front; every test below asserts a different aspect of the same result
		result = driver['getParameterSignature'](sample.path.input);
	});

	test('Creates sha256 hash', () => {
		// Delivery URL signatures use the same SHA-256 digest as request signatures
		expect(createHash).toHaveBeenCalledWith('sha256');
	});

	test('Updates hash with passed filepath + apiSecret', () => {
		// A delivery signature covers the asset path and the secret, nothing else
		expect(mockCreateHash.update).toHaveBeenCalledWith(sample.path.input + sample.config.apiSecret);
	});

	test('Digests hash to base64url', () => {
		// The signature sits in a URL segment, so the URL-safe alphabet is required
		expect(mockCreateHash.digest).toHaveBeenCalledWith('base64url');
	});

	test('Returns first 8 characters of base64 sha hash wrapped in Cloudinary prefix/suffix', () => {
		// Cloudinary compares exactly `s--` plus the first eight characters plus `--`
		expect(result).toBe(`s--${mockHash.substring(0, 8)}--`);
	});
});

describe('#getTimestamp', () => {
	let mockDate: Date;

	beforeEach(() => {
		// A fresh driver, since the shared one has `getTimestamp` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// Freeze the clock, so the expected timestamp is known before the call
		mockDate = randPastDate();
		vi.useFakeTimers();
		vi.setSystemTime(mockDate);
	});

	afterEach(() => {
		// The frozen clock must not outlive the suite, or later suites would see a stale time
		vi.useRealTimers();
	});

	test('Returns unix timestamp in seconds for current time', () => {
		// Cloudinary signs `timestamp` as Unix time in seconds; the value is produced as text straight away because
		// every parameter is signed and sent as text
		expect(driver['getTimestamp']()).toBe(String(Math.floor(mockDate.getTime() / 1000)));
	});
});

describe('#getUploadId', () => {
	beforeEach(() => {
		// A fresh driver, since the shared one has `getUploadId` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});
	});

	test('Returns a random UUID rather than the timestamp', () => {
		// Two uploads started in the same millisecond share a timestamp; a UUID is what keeps their chunks apart
		// on Cloudinary's side
		const mockUuid = randUuid() as ReturnType<typeof randomUUID>;
		vi.mocked(randomUUID).mockReturnValue(mockUuid);

		expect(driver['getUploadId']()).toBe(mockUuid);
		expect(randomUUID).toHaveBeenCalledOnce();
	});
});

describe('#getResourceType', () => {
	beforeEach(() => {
		// A fresh driver, since the shared one has `getResourceType` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});
	});

	test('Returns "image" for extensions contained in the image extensions constant', () => {
		// Every listed extension must route to the image endpoints; one miss would upload that format as `raw`
		IMAGE_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('image');
		});
	});

	test('Returns "video" for extensions contained in the video extensions constant', () => {
		// Every listed extension must route to the video endpoints; one miss would upload that format as `raw`
		VIDEO_EXTENSIONS.forEach((ext) => {
			vi.mocked(extname).mockReturnValue(ext);
			const result = driver['getResourceType'](sample.path.inputFull);
			expect(extname).toHaveBeenCalledWith(sample.path.inputFull);
			expect(result).toBe('video');
		});
	});

	test('Returns "raw" for unknown / other extensions', () => {
		// `extname` is mocked to `undefined` here, which is as unknown as an extension gets; `raw` is the fallback
		randWord({ length: 5 }).forEach((filepath) => expect(driver['getResourceType'](filepath)).toBe('raw'));
	});
});

describe('#getPublicId', () => {
	beforeEach(() => {
		// A fresh driver, since the shared one has `getPublicId` stubbed out; the resource type stays stubbed so
		// each test can pick the branch it exercises
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		driver['getResourceType'] = vi.fn().mockReturnValue(sample.resourceType);

		// The real confinement runs here, since the separator normalisation is part of what is under test
		vi.mocked(confinePath).mockImplementation(confinePathActual);
	});

	test('Gets resourceType for given filepath', () => {
		// The resource type decides whether the extension stays, so it must be derived from the very same path
		driver['getPublicId'](sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Keeps the extension for raw assets', () => {
		// Cloudinary stores no format for raw assets, so the extension is the only way the name survives
		driver['getResourceType'] = vi.fn().mockReturnValue('raw');
		const publicId = driver['getPublicId']('folder/sub/file.tar.gz');
		expect(publicId).toBe('file.tar.gz');
	});

	test('Drops the extension for images and videos', () => {
		// Cloudinary appends the format to image and video ids itself; keeping it would yield `name.png.png`
		driver['getResourceType'] = vi.fn().mockReturnValue(rand(['image', 'video']));
		const publicId = driver['getPublicId']('folder/sub/file.png');
		expect(publicId).toBe('file');
	});

	test('Leaves a leading-dot name without an extension untouched', () => {
		// A name like `.well-known` has no extension, exactly the way `node:path` treated it
		driver['getResourceType'] = vi.fn().mockReturnValue('image');
		const publicId = driver['getPublicId']('.well-known');
		expect(publicId).toBe('.well-known');
	});

	test('Splits on forward slashes whatever the platform separators were', () => {
		// Backslashes arrive from Windows callers; a platform separator would read the whole path as one name there
		driver['getResourceType'] = vi.fn().mockReturnValue('image');
		const publicId = driver['getPublicId']('folder\\sub\\file.png');
		expect(publicId).toBe('file');
	});
});

describe('#getFolderPath', () => {
	beforeEach(() => {
		// A fresh driver, since the shared one has `getFolderPath` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// The real confinement runs here, since the separator normalisation is part of what is under test
		vi.mocked(confinePath).mockImplementation(confinePathActual);
	});

	test('Returns the folder without a trailing separator', () => {
		// The asset-folder parameter wants exactly the directory part of the path
		expect(driver['getFolderPath']('folder/sub/file.png')).toBe('folder/sub');
	});

	test('Returns an empty string for a bare file name', () => {
		// A file at the root has no folder, so the parameter is left out entirely
		expect(driver['getFolderPath']('file.png')).toBe('');
	});

	test('Normalises platform separators to forward slashes', () => {
		// Backslashes arrive from Windows callers; the folder is a Cloudinary entity and always uses forward slashes
		expect(driver['getFolderPath']('folder\\sub\\file.png')).toBe('folder/sub');
	});
});

describe('#getBasicAuth', () => {
	let mockToString: Mock;

	beforeEach(() => {
		// A fresh driver, since the shared one has `getBasicAuth` stubbed out
		driver = new StorageDriverCloudinary({
			apiKey: sample.config.apiKey,
			apiSecret: sample.config.apiSecret,
			cloudName: sample.config.cloudName,
			accessMode: sample.config.accessMode,
		});

		// `Buffer.from` is spied on so the base64 step can be asserted without computing a real encoding
		mockToString = vi.fn();

		vi.spyOn(Buffer, 'from').mockReturnValue({ toString: mockToString } as unknown as Buffer<ArrayBuffer>);
	});

	test('Creates base64 hash of key:secret', () => {
		// The admin API takes the key/secret pair as plain basic-auth credentials, base64 encoded
		driver['getBasicAuth']();

		expect(Buffer.from).toHaveBeenCalledWith(`${sample.config.apiKey}:${sample.config.apiSecret}`);
		expect(mockToString).toHaveBeenCalledWith('base64');
	});

	test(`Returns 'Basic <base64>'`, () => {
		// The header value needs the scheme prefix, or the request is rejected as anonymous
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

	/**
	 * Delivery URL the driver should build for `sample.path.input`. The path segments are percent-encoded because a
	 * random path can carry reserved characters, such as the `+` of `lost+found`.
	 */
	let deliveryUrl: string;

	beforeEach(() => {
		// A successful streaming response by default; tests flip the status or body to cover the failure paths
		mockResponse = {
			status: 200,
			body: new ReadableStream(),
		};

		deliveryUrl = `https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/${sample.path.inputFull.split('/').map(encodeURIComponent).join('/')}`;

		vi.mocked(fetch).mockResolvedValue(mockResponse as Response);
		vi.spyOn(Readable, 'fromWeb').mockReturnValue(sample.stream);
	});

	test('Throws StorageFileNotFoundError when Cloudinary answers 404', async () => {
		// A 404 is the error every backend shares; any other error status stays the generic one
		mockResponse.status = 404;
		mockResponse.body = { cancel: vi.fn(async () => {}) } as unknown as ReadableStream;

		await expect(driver.read(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Gets resource type for extension of given filepath', async () => {
		// The resource type is a segment of the delivery URL, so it is derived from the caller path
		await driver.read(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Creates signature for full filepath', async () => {
		// The delivery signature covers the path with the root, which is what Cloudinary serves the asset under
		await driver.read(sample.path.input);

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
		expect(driver['getParameterSignature']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Calls fetch with generated URL', async () => {
		// Signature, resource type and full path must land in the segments Cloudinary expects them in
		await driver.read(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(deliveryUrl, { method: 'GET' });
	});

	test('Percent-encodes path segments so a public id with reserved characters still addresses one asset', async () => {
		// `?` and `#` are legal in a raw public id, but turn the rest of a URL into a query or fragment; each segment
		// is encoded so the delivery API still reads the id the caller stored
		driver['fullPath'] = vi.fn().mockReturnValue('media/report?v=1.pdf');

		await driver.read(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(
			`https://res.cloudinary.com/${sample.config.cloudName}/${sample.resourceType}/upload/${sample.parameterSignature}/media/report%3Fv%3D1.pdf`,
			{ method: 'GET' },
		);
	});

	test('Adds optional Range header for start', async () => {
		// An open end asks for everything from `start` on
		await driver.read(sample.path.input, { range: { start: sample.range.start, end: undefined } });

		expect(fetch).toHaveBeenCalledWith(deliveryUrl, {
			method: 'GET',
			headers: { Range: `bytes=${sample.range.start}-` },
		});
	});

	test('Adds optional Range header for end', async () => {
		// An omitted start is `0`: `bytes=-N` would mean the last N bytes instead of the first ones
		await driver.read(sample.path.input, { range: { start: undefined, end: sample.range.end } });

		expect(fetch).toHaveBeenCalledWith(deliveryUrl, {
			method: 'GET',
			headers: { Range: `bytes=0-${sample.range.end}` },
		});
	});

	test('Adds optional Range header for start and end', async () => {
		// Both bounds go out as-is; HTTP ranges are inclusive like the driver's
		await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(deliveryUrl, {
			method: 'GET',
			headers: { Range: `bytes=${sample.range.start}-${sample.range.end}` },
		});
	});

	test('Throws error when response has status >= 400', async () => {
		// An error status carries no asset to stream; the caller gets the path, not a broken stream. 404 is kept out
		// of the range because it throws the not-found error, which has its own test
		mockResponse.status = randNumber({ min: 405, max: 599 });

		await expect(driver.read(sample.path.input)).rejects.toThrowError(
			`No stream returned for file "${sample.path.input}"`,
		);
	});

	test('Throws error when response has no readable body', async () => {
		// A 2xx without a body cannot be turned into a stream either, so it is reported the same way
		mockResponse.body = null;

		await expect(driver.read(sample.path.input)).rejects.toThrowError(
			`No stream returned for file "${sample.path.input}"`,
		);
	});

	test('Cancels the response body it never reads', async () => {
		// An unread response body holds its connection open, so the error path must release it
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.read(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns readable stream from web stream', async () => {
		// `fetch` yields a Web stream; the storage layer works with Node readables, so the body is converted
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
		// The record Cloudinary would return for the fixture file, in the field names of its API
		mockResponseBody = {
			bytes: sample.file.size,
			created_at: sample.file.modified.toISOString(),
		};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		// Real joining here, because the public id assertions rebuild `folder/id` the same way the driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for given filepath', async () => {
		// The lookup addresses the asset under the root, so the caller path is resolved first
		await driver.stat(sample.path.input);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for given filepath', async () => {
		// The `explicit` endpoint is per resource type, derived from the full path
		await driver.stat(sample.path.input);
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for given filepath', async () => {
		// The public id is derived from the full path, so the root folder becomes part of it
		await driver.stat(sample.path.input);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Creates signature for body parameters', async () => {
		// The signature covers exactly the parameters sent, with the public id as `folder/id` without a leading
		// slash; any extra or missing key would produce a digest Cloudinary never matches
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
		// `explicit` is a POST with a form body; the content type is what makes Cloudinary parse the parameters
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
		// Any error status but 404 says nothing about the asset, so it surfaces as a plain error with the status
		mockResponse.status = randNumber({ min: 405, max: 599 });

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}" (${mockResponse.status})`,
		);
	});

	test('Maps a 404 to the kit error', async () => {
		// Only a 404 is a definite "missing"; it becomes the error every backend shares
		mockResponse.status = 404;

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input } });
	});

	test('Cancels the response body it never reads', async () => {
		// An unread response body holds its connection open, so the error path must release it
		const cancel = vi.fn().mockResolvedValue(undefined);
		mockResponse.status = randNumber({ min: 400, max: 599 });
		(mockResponse as unknown as { body: unknown }).body = { cancel };

		await expect(driver.stat(sample.path.input)).rejects.toThrowError();

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns size/modified from bytes/created_at from Cloudinary', async () => {
		// Cloudinary reports no modification time, so `created_at` stands in for it
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
		// Stub the lookup itself: `exists` only interprets the status, and `cancel` is tracked to prove the
		// unread body is released
		cancel = vi.fn().mockResolvedValue(undefined);
		requestResource = vi.fn().mockResolvedValue({ status: 200, body: { cancel } });
		driver['requestResource'] = requestResource;
	});

	test('Requests the resource for the given filepath', async () => {
		// The same lookup `stat` uses answers the question; the caller path is passed on untouched
		await driver.exists(sample.path.input);
		expect(requestResource).toHaveBeenCalledWith(sample.path.input);
	});

	test('Returns true if the resource is returned', async () => {
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(true);
	});

	test('Returns false if the resource is not found', async () => {
		// Only a 404 is a definite "no"
		requestResource.mockResolvedValue({ status: 404, body: { cancel } });
		const exists = await driver.exists(sample.path.input);
		expect(exists).toBe(false);
	});

	test.each([401, 420, 503])('Throws if the lookup failed with a %i', async (status) => {
		// Reporting a failed lookup as "the file isn't there" makes callers act on a wrong answer, for example by
		// serving a permission error for a file that does exist
		requestResource.mockResolvedValue({ status, body: { cancel } });

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(
			new Error(`Couldn't check whether file "${sample.path.input}" exists (${status})`),
		);
	});

	test('Cancels the response body it never reads', async () => {
		// An unread response body holds its connection open; `exists` reads only the status
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
		// Real joining here, because the `from`/`to` public id assertions rebuild `folder/id` the same way the
		// driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		// An empty success body by default; the error tests fill in `error.message` to check what is surfaced
		mockResponseBody = {};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for src', async () => {
		// The source is addressed under the root, so its caller path is resolved first
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.src);
	});

	test('Gets full path for dest', async () => {
		// The destination stays under the same root, so it is resolved the same way
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.dest);
	});

	test('Gets public id for src', async () => {
		// `rename` addresses the source by its public id, derived from the full path
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets public id for dest', async () => {
		// The new id follows the same derivation, or an image would end up with its extension in the id
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Gets folder path for src', async () => {
		// The folder is prefixed to the id, so it is taken from the full path
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.srcFull);
	});

	test('Gets folder path for dest', async () => {
		// A move into another folder is expressed through the id prefix, so the destination folder is needed too
		await driver.move(sample.path.src, sample.path.dest);
		expect(driver['getFolderPath']).toHaveBeenCalledWith(sample.path.destFull);
	});

	test('Creates signature for body parameters', async () => {
		// The signature covers exactly the parameters sent; both ids are `folder/id`
		await driver.move(sample.path.src, sample.path.dest);

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			from_public_id: joinPathActual(sample.path.srcFolder, sample.publicId.src),
			to_public_id: joinPathActual(sample.path.destFolder, sample.publicId.dest),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
			invalidate: 'true',
		});
	});

	test('Creates form url encoded body ', async () => {
		await driver.move(sample.path.src, sample.path.dest);

		expect(toFormUrlEncodedUtil.toFormUrlEncoded).toHaveBeenCalledWith({
			from_public_id: joinPathActual(sample.path.srcFolder, sample.publicId.src),
			to_public_id: joinPathActual(sample.path.destFolder, sample.publicId.dest),
			api_key: sample.config.apiKey,
			timestamp: sample.timestamp,
			invalidate: 'true',
			signature: sample.fullSignature,
		});
	});

	test('Fetches URL with url encoded body', async () => {
		// `rename` is per resource type, which comes from the source: a rename cannot change an asset's type
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
		// A rejected rename is reported with the source path, so the caller knows which move failed
		mockResponse.status = randNumber({ min: 400, max: 599 });

		await expect(driver.move(sample.path.src, sample.path.dest)).rejects.toThrowError(
			`Can't move file "${sample.path.src}": Unknown`,
		);
	});

	test(`Defaults to Unknown if error object doesn't contain message`, async () => {
		// An error object without a message still needs a readable reason
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		await expect(driver.move(sample.path.src, sample.path.dest)).rejects.toThrowError(
			`Can't move file "${sample.path.src}": Unknown`,
		);
	});

	test(`Renders message if returned by Cloudinary`, async () => {
		// Cloudinary explains a rejected rename in the body; that explanation is what the caller needs
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randText() };

		await expect(driver.move(sample.path.src, sample.path.dest)).rejects.toThrowError(
			`Can't move file "${sample.path.src}": ${mockResponseBody.error.message}`,
		);
	});
});

describe('#copy', () => {
	beforeEach(() => {
		// `copy` is only a read piped into a write, so both are stubbed and the wiring between them is asserted
		driver.read = vi.fn().mockResolvedValue(sample.stream);
		driver.write = vi.fn();
	});

	test('Calls read with input path', async () => {
		// Cloudinary has no server-side copy, so the source is read back through this process
		await driver.copy(sample.path.src, sample.path.dest);
		expect(driver.read).toHaveBeenCalledWith(sample.path.src);
	});

	test('Calls write with dest path and read stream', async () => {
		// The stream read from the source is what gets uploaded under the destination path
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
		// Random short chunks are enough for the tests that only care about the helpers `write` calls; they stay
		// far below the chunk size, so everything goes out as the single last request
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
		// The chunk upload is stubbed, so these tests cover the buffering and queueing rather than the HTTP call;
		// its arguments are read from `mock.calls`, because vitest cannot print a `Blob` in an assertion diff and
		// fails with a `TypeError` instead of a readable mismatch
		driver['uploadChunk'] = vi.fn();

		// Real bytes flow through the buffering loop here, so the cuts and the chunk sizes are what gets checked
		useActualBuffers();
	});

	test('Gets full path for input', async () => {
		// The asset is placed under the root, so the caller path is resolved first
		await driver.write(sample.path.input, createStream());

		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', async () => {
		// The upload endpoint is per resource type, derived from the full path
		await driver.write(sample.path.input, createStream());

		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Constructs signature from correct upload parameters', async () => {
		// A folder becomes the asset folder and the id prefix; the signature must cover exactly these parameters
		await driver.write(sample.path.input, createStream());

		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			type: 'upload',
			access_mode: sample.config.accessMode,
			invalidate: 'true',
			public_id: sample.publicId.input,
			asset_folder: sample.path.inputFolder,
			use_asset_folder_as_public_id_prefix: 'true',
		});
	});

	test('Queues upload once stream has buffered', async () => {
		// A small stream fits one buffer, so a single request carries the whole file together with its total
		await driver.write(sample.path.input, createStream());

		expect(driver['uploadChunk']).toHaveBeenCalledOnce();
	});

	test('Sends every chunk under the upload id of this write', async () => {
		// The id is a header rather than a signed parameter, so it has to reach `uploadChunk` on its own
		await driver.write(sample.path.input, createStream());

		expect(vi.mocked(driver['uploadChunk']).mock.calls[0]![0].uploadId).toBe(sample.uploadId);
	});

	test('Queues chunk upload each time chunks add up to more than the upload chunk size', async () => {
		// The chunk size is five percent above the Cloudinary minimum, so the first 6 MB pass one cut: the first
		// chunk goes out with an unknown total and the remainder plus the final 1 MB is the last request, which
		// carries the real total
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);

		await driver.write(
			sample.path.input,
			createStream([BufferActual.alloc(3e6), BufferActual.alloc(3e6), BufferActual.alloc(1e6)]),
		);

		expect(chunkRanges()).toStrictEqual([
			[0, chunkSize, -1],
			[chunkSize, 7e6 - chunkSize, 7e6],
		]);
	});

	test('Keeps a buffer of exactly the chunk size for the last request', async () => {
		// A source that adds up to exactly the chunk size is one chunk; sending it early with an unknown total would
		// leave Cloudinary waiting for a final request that never comes
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);

		await driver.write(sample.path.input, createStream([BufferActual.alloc(chunkSize)]));

		expect(chunkRanges()).toStrictEqual([[0, chunkSize, chunkSize]]);
	});

	test('Sends every byte when one source chunk is larger than the upload chunk size', async () => {
		// A 12 MB source chunk holds two full upload chunks: the loop used to compute the space left in the buffer,
		// which went negative on the second cut and silently dropped bytes
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);

		await driver.write(sample.path.input, createStream([BufferActual.alloc(12e6, 1), BufferActual.alloc(12e6, 2)]));

		// 24 MB is four full chunks and a tail, with contiguous offsets and the total only on the last one
		expect(chunkRanges()).toStrictEqual([
			[0, chunkSize, -1],
			[chunkSize, chunkSize, -1],
			[2 * chunkSize, chunkSize, -1],
			[3 * chunkSize, chunkSize, -1],
			[4 * chunkSize, 24e6 - 4 * chunkSize, 24e6],
		]);

		// The chunk spanning both sources switches from the first fill value to the second where the second source
		// begins, at 12 MB minus the two full chunks already cut from the first source
		const bytes = new Uint8Array(await vi.mocked(driver['uploadChunk']).mock.calls[2]![0].blob.arrayBuffer());

		const switchAt = 12e6 - 2 * chunkSize;

		expect(bytes[0]).toBe(1);
		expect(bytes[switchAt - 1]).toBe(1);
		expect(bytes[switchAt]).toBe(2);
		expect(bytes[bytes.length - 1]).toBe(2);
	});

	test('Reports the first failed chunk with the path once every request has settled', async () => {
		// The failure is remembered rather than thrown mid-stream, so the queue drains before the caller hears
		// about it and no request is left dangling
		const cause = new Error(randText());
		vi.mocked(driver['uploadChunk']).mockRejectedValueOnce(cause);

		await expect(driver.write(sample.path.input, createStream())).rejects.toThrowError(
			`Can't upload file "${sample.path.input}": ${cause.message}`,
		);
	});

	test('Reports the first of several failed chunks', async () => {
		// Chunks run concurrently and every request settles before the error surfaces, so the reported failure must
		// be the first one remembered rather than whichever chunk rejected last
		const first = new Error(randText());
		const last = new Error(randText());

		vi.mocked(driver['uploadChunk']).mockRejectedValueOnce(first).mockRejectedValueOnce(last);

		await expect(
			driver.write(sample.path.input, createStream([BufferActual.alloc(6e6), BufferActual.alloc(6e6)])),
		).rejects.toThrowError(`Can't upload file "${sample.path.input}": ${first.message}`);
	});

	test('Signs every chunk under the timestamp of its own request', async () => {
		// Cloudinary refuses a signature older than an hour, so a write that runs longer than that must not reuse
		// one timestamp taken up front; each chunk asks for its own
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);

		vi.mocked(driver['getTimestamp']).mockReturnValueOnce('1').mockReturnValueOnce('2');

		await driver.write(sample.path.input, createStream([BufferActual.alloc(chunkSize + 1)]));

		expect(
			vi.mocked(driver['uploadChunk']).mock.calls.map(([options]) => options.parameters['timestamp']),
		).toStrictEqual(['1', '2']);

		expect(driver['getFullSignature']).toHaveBeenCalledWith(expect.objectContaining({ timestamp: '1' }));
		expect(driver['getFullSignature']).toHaveBeenCalledWith(expect.objectContaining({ timestamp: '2' }));
	});

	test('Pauses reading the source while the upload queue is full', async () => {
		// Every upload hangs until released, so only backpressure can stop the loop from reading the whole source
		// into queued chunk copies
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);
		const release: (() => void)[] = [];

		vi.mocked(driver['uploadChunk']).mockImplementation(() => new Promise<void>((resolve) => release.push(resolve)));

		let pulls = 0;

		const source = Readable.from(
			(async function* () {
				for (let index = 0; index < 100; index++) {
					pulls += 1;
					yield BufferActual.alloc(chunkSize);
				}
			})(),
		);

		const writing = driver.write(sample.path.input, source);

		// Let the loop run as far as it can while nothing completes: ten in flight plus ten waiting, far below the
		// hundred chunks the source could deliver
		for (let tick = 0; tick < 50; tick++) {
			await new Promise((resolve) => setImmediate(resolve));
		}

		expect(pulls).toBeLessThan(30);

		// Releasing the uploads as they start lets the write run to the end with every chunk sent
		const drain = setInterval(() => release.splice(0).forEach((resolve) => resolve()), 1);

		await writing;
		clearInterval(drain);

		expect(driver['uploadChunk']).toHaveBeenCalledTimes(100);
	});

	test('Sends the final chunk only after every earlier chunk has settled', async () => {
		// Earlier chunks hang until released; the chunk carrying the real total makes Cloudinary assemble the asset,
		// so it may not start while they are still in flight
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);
		const release: (() => void)[] = [];

		vi.mocked(driver['uploadChunk']).mockImplementation(({ bytesTotal }) =>
			bytesTotal === -1 ? new Promise<void>((resolve) => release.push(resolve)) : Promise.resolve(),
		);

		const writing = driver.write(sample.path.input, createStream([BufferActual.alloc(2 * chunkSize + 1)]));

		for (let tick = 0; tick < 20; tick++) {
			await new Promise((resolve) => setImmediate(resolve));
		}

		expect(chunkRanges().map(([, , total]) => total)).toStrictEqual([-1, -1]);

		release.splice(0).forEach((resolve) => resolve());
		await writing;

		expect(chunkRanges().map(([, , total]) => total)).toStrictEqual([-1, -1, 2 * chunkSize + 1]);
	});

	test('Does not send the final chunk when an earlier chunk failed', async () => {
		// The final chunk would complete the asset with a gap where the failed chunk belongs, replacing the previous
		// asset under the same public id, so the write must stop before it
		const chunkSize = Math.ceil(MINIMUM_CHUNK_SIZE * 1.05);
		const cause = new Error(randText());

		vi.mocked(driver['uploadChunk']).mockRejectedValueOnce(cause);

		await expect(
			driver.write(sample.path.input, createStream([BufferActual.alloc(chunkSize + 1)])),
		).rejects.toThrowError(`Can't upload file "${sample.path.input}": ${cause.message}`);

		expect(chunkRanges()).toStrictEqual([[0, chunkSize, -1]]);
	});

	test('Rejects an empty write instead of resolving while nothing is stored', async () => {
		// Cloudinary accepts no zero-length chunk, so an empty stream stores nothing; resolving would leave any
		// previous asset under the same public id untouched while reading as success, which is why the write refuses
		await expect(driver.write(sample.path.input, createStream([]))).rejects.toThrowError(
			new InvalidPayloadError({ reason: `Can't upload file "${sample.path.input}": the stream is empty` }),
		);

		expect(driver['uploadChunk']).not.toHaveBeenCalled();
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
		// An empty success body by default; the error tests fill in `error.message` to check what is surfaced
		mockResponseBody = {};

		mockResponse = {
			json: vi.fn().mockResolvedValue(mockResponseBody),
			status: 200,
		};

		// `FormData` is mocked, so the fields the driver sets can be asserted without inspecting a real body
		mockFormData = {
			set: vi.fn(),
		};

		// A minimal chunk: only `size` matters for the `Content-Range` header, so the blob is a plain stub
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
		await driver['uploadChunk'](input);

		expect(FormData).toHaveBeenCalledOnce();
		expect(FormData).toHaveBeenCalledWith();
	});

	test('Saves all passed parameters to form data', async () => {
		// Every signed parameter travels as a text field next to the file, or the signature would not verify
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
		// `Content-Range` places the chunk and `X-Unique-Upload-Id` joins it with the others; the range end is
		// inclusive, hence the `- 1`
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
		// Two uploads started in the same millisecond share a timestamp, so it cannot be what joins the chunks
		await driver['uploadChunk'](input);

		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const headers = init!.headers as Record<string, string>;

		expect(headers['X-Unique-Upload-Id']).toBe(sample.uploadId);
		expect(headers['X-Unique-Upload-Id']).not.toBe(sample.timestamp);
	});

	test('Throws an error when the response statusCode is >=400', async () => {
		// A rejected chunk is reported; `write` wraps the message with the path later
		mockResponse.status = randNumber({ min: 400, max: 599 });

		await expect(driver['uploadChunk'](input)).rejects.toThrowError('Unknown');
	});

	test('Defaults to Unknown if Cloudinary API response error message is not known', async () => {
		// An error object without a message still needs a readable reason
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		await expect(driver['uploadChunk'](input)).rejects.toThrowError('Unknown');
	});

	test('Sets error message to Cloudinary return message', async () => {
		// Cloudinary explains a rejected chunk in the body; that explanation is what the caller needs
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = { message: randWord() };

		await expect(driver['uploadChunk'](input)).rejects.toThrowError(mockResponseBody.error.message);
	});
});

describe('#delete', () => {
	beforeEach(async () => {
		// Real joining here, because the public id assertion rebuilds `folder/id` the same way the driver does
		vi.mocked(joinPath).mockImplementation(joinPathActual);

		// Cloudinary answers a destroy with 200, `result: 'ok'` or `'not found'` alike; a missing asset is deleted
		vi.mocked(fetch).mockResolvedValue({ status: 200, json: async () => ({ result: 'ok' }) } as unknown as Response);

		// One call up front; every test below asserts a different helper or request the call made
		await driver.delete(sample.path.input);
	});

	test('Throws when Cloudinary answers with an error status instead of resolving', async () => {
		// A rotated secret, a rate limit or a 5xx is a delete that did not happen, and must not read as one
		vi.mocked(fetch).mockResolvedValue({
			status: 401,
			json: async () => ({ error: { message: 'Invalid Signature' } }),
		} as unknown as Response);

		await expect(driver.delete(sample.path.input)).rejects.toThrow(
			`Error deleting file "${sample.path.input}": Invalid Signature`,
		);
	});

	test('Gets full path', () => {
		// The asset is addressed under the root, so the caller path is resolved first
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Gets resource type for full path', () => {
		// `destroy` is per resource type, derived from the full path
		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Gets publicId for full path', () => {
		// The public id is derived from the full path, so the root folder becomes part of it
		expect(driver['getPublicId']).toHaveBeenCalledWith(sample.path.inputFull);
	});

	test('Generates signature for delete parameters', () => {
		// `resource_type` is sent as a parameter as well; it sits on the signing denylist, so the signature stays
		// valid either way
		expect(driver['getFullSignature']).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			resource_type: sample.resourceType,
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			invalidate: 'true',
		});
	});

	test('Calls fetch with correct parameters', async () => {
		expect(toFormUrlEncodedUtil.toFormUrlEncoded).toHaveBeenCalledWith({
			timestamp: sample.timestamp,
			api_key: sample.config.apiKey,
			resource_type: sample.resourceType,
			public_id: normalizePath(joinPathActual(sample.path.inputFolder, sample.publicId.input), { removeLeading: true }),
			invalidate: 'true',
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
		// A single page of raw resources (no `resource_type`), so the yielded paths equal the public ids as-is
		mockFilePaths = randFilePath({ length: randNumber({ min: 1, max: 10 }) });

		mockResponseBody = {
			resources: mockFilePaths.map((filepath) => ({
				public_id: filepath,
			})),
		};

		// No `next_cursor` by default, so the listing stops after one request unless a test adds one
		mockResponse = {
			status: 200,
			json: vi.fn().mockResolvedValue(mockResponseBody),
		};

		vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
	});

	test('Gets full path for prefix', async () => {
		// The prefix is searched under the root, so the caller prefix is resolved first
		await driver.list(sample.path.input).next();
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Fetches search api results', async () => {
		// The search API takes a wildcard expression and basic auth; an empty cursor asks for the first page. The
		// expression pins the prefix to the `public_id` field and quotes it, so the search language cannot read a
		// caller-controlled prefix as operators
		await driver.list(sample.path.input).next();

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?expression=${encodeURIComponent(
				`public_id:"${sample.path.inputFull}*"`,
			)}&next_cursor=`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Quotes and pins a prefix carrying search-language operators', async () => {
		// A prefix like `x OR public_id:*` would, unquoted, list every asset in the account past the location root;
		// the expression must address only the public ids under the given prefix
		driver['fullPath'] = vi.fn().mockReturnValue('x OR public_id:*');

		await driver.list(sample.path.input).next();

		const query = new URLSearchParams({ expression: 'public_id:"x OR public_id:**"', next_cursor: '' });

		expect(fetch).toHaveBeenCalledWith(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/search?${query}`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Yields resource public IDs from response', async () => {
		// Without a root, raw public ids are the paths callers pass in, so they come back untouched
		const output: string[] = [];

		for await (const path of driver.list(sample.path.input)) {
			output.push(path);
		}

		expect(output.length).toBe(mockResponseBody.resources.length);
		expect(output).toStrictEqual(mockFilePaths);
	});

	test('Keeps calling fetch as long as a next_cursor is returned', async () => {
		// The search API pages with a cursor; the second request must carry the cursor the first one returned
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
				`public_id:"${sample.path.inputFull}*"`,
			)}&next_cursor=${mockNextCursor}`,
			{
				method: 'GET',
				headers: {
					Authorization: sample.basicAuth,
				},
			},
		);
	});

	test('Reads a 2xx answer without JSON body as an empty page', async () => {
		// A proxy's HTML page on a 2xx would crash the listing on an un iterable `resources`; it reads as no assets
		// under the prefix instead
		mockResponse.json.mockResolvedValue({});

		const output: string[] = [];

		for await (const path of driver.list(sample.path.input)) {
			output.push(path);
		}

		expect(output).toStrictEqual([]);
	});

	test('Throws error if search api fails', async () => {
		// A failed search is reported with the prefix, so the caller knows which listing failed
		mockResponse.status = randNumber({ min: 400, max: 599 });

		await expect(driver.list(sample.path.input).next()).rejects.toThrow(
			`Can't list for prefix "${sample.path.input}": Unknown`,
		);
	});

	test('Defaults to Unknown error if the error response does not contain a message', async () => {
		// An error object without a message still needs a readable reason
		mockResponse.status = randNumber({ min: 400, max: 599 });
		mockResponseBody.error = {};

		await expect(driver.list(sample.path.input).next()).rejects.toThrow(
			`Can't list for prefix "${sample.path.input}": Unknown`,
		);
	});

	test('Provides Cloudinary error message, read from the body once', async () => {
		// A body can be read once: a second `json()` on a real response rejects with "Body is unusable"
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

describe('#call', () => {
	beforeEach(() => {
		// The real request of `@novastarter/http`, with the real deadline, over the mocked `undici` fetch
		vi.mocked(withTimeout).mockImplementation(withTimeoutActual);
		vi.mocked(fetch).mockResolvedValue(new globalThis.Response('{"resources":[]}', { status: 200 }) as never);
	});

	/**
	 * The URL and init of the one request made.
	 *
	 * @returns What `fetch` was called with.
	 */
	const request = (): [string, { method: string; headers: Record<string, string>; body?: unknown }] =>
		vi.mocked(fetch).mock.calls[0] as never;

	test('Requests a path under the cloud with basic auth and the query of a GET', async () => {
		// The path goes under `/v1_1/<cloud>`; the parameters into the query; the key and secret as basic auth
		const result = await driver.call('GET /resources/image', { max_results: 100, prefix: 'a b' });

		const [url, init] = request();

		expect(url).toBe(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/image?max_results=100&prefix=a+b`,
		);

		expect(init.method).toBe('GET');
		expect(init.headers['authorization']).toBe(sample.basicAuth);
		expect(init.body).toBeUndefined();
		expect(result.data).toEqual({ resources: [] });
	});

	test('Fills a placeholder from the parameters, encoded, and does not send that parameter again', async () => {
		// `{tag}` takes the `tag` parameter; a `/` in it cannot reshape the path, and only the rest is the query
		await driver.call('GET /resources/image/tags/{tag}', { tag: 'a/b c', max_results: 10 });

		expect(request()[0]).toBe(
			`https://api.cloudinary.com/v1_1/${sample.config.cloudName}/resources/image/tags/a%2Fb%20c?max_results=10`,
		);
	});

	test('Refuses a placeholder nobody filled before any request', async () => {
		// Sent, `{tag}` would reach Cloudinary as `%7Btag%7D`
		await expect(driver.call('GET /resources/image/tags/{tag}')).rejects.toThrow('needs a "tag" parameter');

		expect(fetch).not.toHaveBeenCalled();
	});

	test('Answers with the status, the headers lower-cased and the body', async () => {
		// The Admin API's hourly budget arrives in headers
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"resources":[]}', {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'X-FeatureRateLimit-Remaining': '499' },
			}) as never,
		);

		const result = await driver.call('GET /resources/image');

		expect(result).toEqual({
			status: 200,
			headers: { 'content-type': 'application/json', 'x-featureratelimit-remaining': '499' },
			data: { resources: [] },
		});
	});

	test('Sends the parameters of a POST as JSON, with the headers of the caller', async () => {
		// A JSON body; the caller's headers go over the driver's
		await driver.call('POST /tags/image', { tag: 'x', public_ids: ['a'] }, { headers: { 'X-Request-Id': 'r' } });

		const [, init] = request();

		expect(init.body).toBe('{"tag":"x","public_ids":["a"]}');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-request-id': 'r' });
	});

	test('Hands a file among the parameters to undici as its own FormData', async () => {
		// The global `FormData` httpCall builds is copied into `undici`'s, stubbed so its fields can be asserted
		const form = { append: vi.fn() };
		vi.mocked(FormData).mockReturnValue(form as unknown as FormData);

		await driver.call('POST /image/upload', { file: new File(['x'], 'a.png'), upload_preset: 'p' });

		const [, init] = request();

		expect(init.body).toBe(form);
		expect(form.append).toHaveBeenCalledWith('upload_preset', 'p');
		expect(form.append).toHaveBeenCalledWith('file', expect.any(File));
	});

	test('Hands undici redirect: manual, so a redirect is never followed with the credentials', async () => {
		// `httpCall` follows redirects itself and drops the credentials off the origin; undici must not do it first
		await driver.call('GET /usage');

		expect(request()[1]).toMatchObject({ redirect: 'manual' });
	});

	test('Refuses a full URL on a foreign host before any request', async () => {
		// The key and secret would go wherever the URL points
		await expect(driver.call('GET https://evil.example/usage')).rejects.toThrow('not on a host of this provider');

		expect(fetch).not.toHaveBeenCalled();
	});

	test('Accepts a full URL on a regional API host', async () => {
		// A cloud in the EU region is reached through its own host, which only a full URL names
		await driver.call(`GET https://api-eu.cloudinary.com/v1_1/${sample.config.cloudName}/usage`);

		expect(request()[0]).toBe(`https://api-eu.cloudinary.com/v1_1/${sample.config.cloudName}/usage`);
	});

	test('Turns an error status into a ProviderCallError without the credentials', async () => {
		// Cloudinary's `{ error: { message } }` reaches the message; the auth header never does
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"error":{"message":"Resource not found"}}', { status: 404 }) as never,
		);

		const error = await driver.call('GET /resources/image/upload/x').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toEqual({
			provider: 'cloudinary',
			method: 'GET /resources/image/upload/x',
			status: 404,
			body: { error: { message: 'Resource not found' } },
		});

		expect((error as Error).message).toContain('Resource not found');
		expect((error as Error).message).not.toContain(sample.basicAuth);
		expect((error as Error).message).not.toContain(sample.config.apiSecret);
		expect((error as Error).message).not.toContain(sample.config.apiKey);
	});

	test.each([429, 420])('Turns a %s into a HitRateLimitError', async (status) => {
		// Cloudinary's Admin API answers 420 once the hourly budget is spent; the reset time it names is the wait
		const reset = new Date(Date.now() + 60_000);

		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"error":{"message":"Rate Limit Exceeded"}}', {
				status,
				headers: { 'x-featureratelimit-reset': reset.toUTCString() },
			}) as never,
		);

		const error = await driver.call('GET /usage').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(HitRateLimitError);
	});

	test('Gives up at the timeout of the caller', async () => {
		// A request that never answers ends at the deadline; the error is matched by shape across module copies
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /usage', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });
	});
});

describe('#tusExtensions', () => {
	test('Advertises creation, termination and expiration', () => {
		// Exactly the extensions the chunked-upload methods back; the TUS server refuses a client feature that is
		// not on this list
		expect(driver.tusExtensions).toStrictEqual(['creation', 'termination', 'expiration']);
	});
});

describe('#createChunkedUpload', () => {
	test('Records only the upload id in the context metadata', async () => {
		// The context is what the TUS server hands back on every later call, so the id must survive in it; no
		// timestamp is saved, since a signature under it would go stale an hour into the upload
		const context = { size: randNumber(), metadata: {} };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result).toBe(context);
		expect(result.metadata).toStrictEqual({ uploadId: sample.uploadId });
	});

	test('Creates the metadata map when the client sent none', async () => {
		// A POST without `Upload-Metadata` leaves the map undefined; recording the upload state must not throw a
		// TypeError, which would leave the TUS server without the context it persists
		const context = { size: randNumber(), metadata: undefined };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result.metadata).toStrictEqual({ uploadId: sample.uploadId });
	});

	test('Drops a completion flag sent by the client', async () => {
		// The flag tells a termination to delete the asset; taken from `Upload-Metadata`, it would let a DELETE on an
		// unfinished upload destroy the asset the upload was meant to replace
		const context = { size: randNumber(), metadata: { uploadCompleted: 'true' } };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result.metadata).toStrictEqual({ uploadId: sample.uploadId });
	});
});

describe('#writeChunk', () => {
	let context: { size: number; metadata: Record<string, string | null> };

	beforeEach(() => {
		// The chunk upload is stubbed, so these tests cover what the context contributes to the request
		driver['uploadChunk'] = vi.fn();

		// Real bytes flow through the buffering here, so the offsets and totals are what gets checked
		useActualBuffers();

		// A context as `createChunkedUpload` leaves it, for a 6-byte upload
		context = { size: 6, metadata: { uploadId: sample.uploadId } };
	});

	test('Sends the chunk under the upload id the upload started with', async () => {
		// A later chunk must join the same Cloudinary upload, so the id may not be regenerated per chunk
		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.uploadId).toBe(sample.uploadId);
		expect(driver['getUploadId']).not.toHaveBeenCalled();
	});

	test('Signs every chunk under a fresh timestamp, not one saved when the upload started', async () => {
		// Cloudinary refuses a signature older than an hour, so a paused upload resumed later must not reuse the
		// creation timestamp; a stale one left in the context by an older upload is ignored for signing too
		const stale = String(Number(sample.timestamp) - 7200);
		const fresh = String(Number(sample.timestamp) + 1);

		context.metadata['timestamp'] = stale;
		vi.mocked(driver['getTimestamp']).mockReturnValue(fresh);

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.parameters['timestamp']).toBe(fresh);
		expect(driver['getFullSignature']).toHaveBeenCalledWith(expect.objectContaining({ timestamp: fresh }));
	});

	test('Asks Cloudinary to invalidate the CDN copies of an overwritten asset', async () => {
		// `read` fetches an unversioned delivery URL, so without invalidation the CDN keeps serving the old bytes
		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.parameters['invalidate']).toBe('true');
		expect(driver['getFullSignature']).toHaveBeenCalledWith(expect.objectContaining({ invalidate: 'true' }));
	});

	test('Takes the timestamp only after the chunk body has been read', async () => {
		// One large PATCH over a slow link can stream in for more than an hour; a timestamp taken before the body
		// is read would already be stale when the chunk goes out
		let drained = false;

		const body = Readable.from(
			(async function* () {
				yield BufferActual.from('abc');
				drained = true;
			})(),
		);

		vi.mocked(driver['getTimestamp']).mockImplementation(() => (drained ? 'after-body' : 'before-body'));

		await driver.writeChunk(sample.path.input, body, 0, context);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.parameters['timestamp']).toBe('after-body');
	});

	test('Records the upload as completed once the final chunk is accepted', async () => {
		// Cloudinary stores the asset on the chunk carrying the real total, so only that chunk sets the flag a
		// later termination reads; an earlier one leaves it unset
		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		expect(context.metadata['uploadCompleted']).toBeUndefined();

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('def')]), 3, context);

		expect(context.metadata['uploadCompleted']).toBe('true');
	});

	test('Leaves the upload unfinished when the final chunk is refused', async () => {
		// A refused final chunk stored nothing, so the flag stays unset and a termination keeps the previous asset
		vi.mocked(driver['uploadChunk']).mockRejectedValue(new Error('Refused'));

		await expect(
			driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abcdef')]), 0, context),
		).rejects.toThrow('Refused');

		expect(context.metadata['uploadCompleted']).toBeUndefined();
	});

	test('Derives the resource type from the full path, the way write and delete do', async () => {
		// The root can end in a name with an extension, so the caller path alone can pick the wrong resource type;
		// like `write`, `delete` and `move`, the resolved full path is what the type is derived from
		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		expect(driver['getResourceType']).toHaveBeenCalledWith(sample.path.inputFull);

		expect(vi.mocked(driver['uploadChunk']).mock.calls[0]![0].resourceType).toBe(sample.resourceType);
	});

	test('Falls back to the timestamp as upload id for an upload started without one', async () => {
		// Chunks of an upload created before the id was recorded went out under the timestamp; switching ids
		// halfway would strand them
		const legacy = String(Number(sample.timestamp) - 7200);

		context.metadata = { timestamp: legacy };

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, context);

		expect(vi.mocked(driver['uploadChunk']).mock.calls[0]![0].uploadId).toBe(legacy);
	});

	test('Copes with a context that carries no metadata map', async () => {
		// A context handed over without its map must not crash on reading the upload state; a missing session is the
		// API's error to report once the request goes out, not a TypeError of the driver
		const bareContext = { size: 6, metadata: undefined };

		await driver.writeChunk(sample.path.input, Readable.from([BufferActual.from('abc')]), 0, bareContext);

		expect(bareContext.metadata).toStrictEqual({});
	});

	test('Refuses a chunk above the configured size', async () => {
		// The TUS server agrees to send at most the configured size per request; a larger chunk is refused before it
		// is sent, so Cloudinary never assembles bytes the upload did not agree to carry
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
			new InvalidPayloadError({
				reason: `The chunk of ${MINIMUM_CHUNK_SIZE + 1} bytes exceeds the chunk size limit of ${MINIMUM_CHUNK_SIZE} bytes`,
			}),
		);

		expect(vi.mocked(tusDriver['uploadChunk'])).not.toHaveBeenCalled();
	});

	test('Refuses an oversized chunk while it is still streaming', async () => {
		// The bound is checked on the running total inside the loop, so a chunk that never ends is refused after the
		// piece that crosses it rather than being buffered whole — an endless chunk would otherwise exhaust the heap
		// before the driver ever refused it
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

		let pulls = 0;

		const endless = Readable.from(
			(async function* () {
				while (true) {
					pulls += 1;
					yield BufferActual.alloc(1e6);
				}
			})(),
		);

		await expect(tusDriver.writeChunk(sample.path.input, endless, 0, context)).rejects.toThrow(InvalidPayloadError);

		// The refusal happens on the piece that crosses the bound and the stream is abandoned rather than drained,
		// so the generator must not keep running past a buffered prefetch
		await new Promise((resolve) => setImmediate(resolve));

		expect(pulls).toBeLessThan(10);

		expect(vi.mocked(tusDriver['uploadChunk'])).not.toHaveBeenCalled();
	});

	test('Converts string chunks to buffers before counting and buffering', async () => {
		// A chunk stream that yields strings — an object-mode readable or one with an encoding set — used to make
		// `chunk.length` count characters and `Buffer.concat` throw; the chunk is converted the way `write` does it
		vi.mocked(Buffer.from).mockImplementation(BufferActual.from);

		await expect(driver.writeChunk(sample.path.input, Readable.from(['abc']), 0, context)).resolves.toBe(3);

		const [options] = vi.mocked(driver['uploadChunk']).mock.calls[0]!;

		expect(options.blob.size).toBe(3);
	});

	test('Declares an unknown total until the chunk that completes the upload', async () => {
		// Cloudinary assembles the asset on the request that carries the real total, so an earlier chunk must
		// send `-1` and the last one the declared size; the returned offset is what the TUS server stores
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

	test('Sends no request for an empty chunk and returns the offset unchanged', async () => {
		// An empty chunk would send `Content-Range: bytes 0--1/0`, which Cloudinary rejects, so nothing is sent and
		// the given offset comes back, the way the Azure driver skips the append of an empty chunk
		await expect(driver.writeChunk(sample.path.input, Readable.from([]), 3, context)).resolves.toBe(3);

		expect(vi.mocked(driver['uploadChunk'])).not.toHaveBeenCalled();
	});
});

describe('#deleteChunkedUpload', () => {
	test('Leaves the asset under the public id in place for an unfinished upload', async () => {
		// Until the final chunk arrives the public id still holds the previous asset, so cancelling an overwrite
		// must not destroy it; Cloudinary discards the unfinished chunks on its own
		driver.delete = vi.fn();

		await driver.deleteChunkedUpload(sample.path.input, { size: 6, metadata: { uploadId: sample.uploadId } });

		expect(driver.delete).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	test('Deletes the asset of an upload whose final chunk was accepted', async () => {
		// A finished upload stored its asset under the public id, so a termination afterwards removes it rather than
		// leaving the file behind, the way the other drivers do
		driver.delete = vi.fn();

		await driver.deleteChunkedUpload(sample.path.input, {
			size: 6,
			metadata: { uploadId: sample.uploadId, uploadCompleted: 'true' },
		});

		expect(driver.delete).toHaveBeenCalledExactlyOnceWith(sample.path.input);
	});
});
