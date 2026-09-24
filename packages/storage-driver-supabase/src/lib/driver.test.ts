/**
 * Tests of `storage-driver-supabase/lib/driver`.
 */
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import {
	randAlphaNumeric,
	randGitBranch as randBucket,
	randDirectoryPath,
	randDomainName,
	randFileName,
	randFilePath,
	randFileType,
	randNumber,
	randPastDate,
	randText,
	randGitShortSha as randUnique,
} from '@ngneat/falso';
import { DEFAULT_CHUNK_SIZE } from '@novastarter/constants';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { StorageFileNotFoundError } from '@novastarter/storage';
import { StorageClient } from '@supabase/storage-js';
import * as tus from 'tus-js-client';
import { fetch, FormData, Response } from 'undici';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverSupabaseConfig } from './driver.js';
import { StorageDriverSupabase } from './driver.js';

vi.mock('@supabase/storage-js');
vi.mock('tus-js-client');
vi.mock('undici');

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	config: { [Key in keyof StorageDriverSupabaseConfig]-?: NonNullable<StorageDriverSupabaseConfig[Key]> };
	path: {
		input: string;
		src: string;
		dest: string;
	};
	range: {
		start: number;
		end: number;
	};
	stream: Readable;
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
let driver: StorageDriverSupabase;

/**
 * Bucket handle the driver keeps in its private `bucket` field; tests swap it for a stand-in with the methods they need.
 */
type BucketApi = ReturnType<StorageClient['from']>;

/**
 * Request options the driver hands the mocked `undici` fetch, as the copy assertions read them.
 */
type SentInit = { method: string; headers: Record<string, string>; body: string };

/**
 * Answer a stand-in `list` gives: a page of entries, or nothing when the call failed.
 */
type ListAnswer = { data: { name: string; id: string | null }[] | null; error: Error | null };

/**
 * Options the driver hands `tus.Upload`, with the callbacks the tests fire marked as always present.
 */
type CapturedOptions = ConstructorParameters<typeof tus.Upload>[1] & {
	[Key in 'onUploadUrlAvailable' | 'onChunkComplete' | 'onError' | 'onAfterResponse']-?: NonNullable<
		ConstructorParameters<typeof tus.Upload>[1][Key]
	>;
};

/**
 * Build the listing entry Supabase returns for a file, with the metadata `stat` reads.
 *
 * @param name - Entry name relative to the listed folder.
 * @param size - Reported size in bytes.
 * @param modified - Reported modification date.
 * @returns A file entry with a non-null id, which is how the driver tells files from folders.
 */
function fileEntry(name: string, size: number, modified: Date) {
	return { name, id: randUnique(), metadata: { contentLength: size, lastModified: modified } };
}

/**
 * Build the listing entry Supabase returns for a folder: no id and no metadata.
 *
 * @param name - Folder name relative to the listed folder.
 * @returns A folder entry.
 */
function folderEntry(name: string) {
	return { name, id: null, metadata: null };
}

/**
 * Build a byte-mode stream holding one chunk, the way the TUS server hands a chunk to `writeChunk`.
 *
 * `writeChunk` buffers the chunk before handing it to `tus-js-client`, so the stream must be readable: `Readable.from`
 * defaults to object mode, in which `read(size)` ignores the size, and a bare `new Readable()` has no `_read`
 * implementation at all, so both would fail the moment the driver reads them.
 *
 * @param bytes - Chunk contents.
 * @returns A readable of exactly those bytes.
 */
function chunkStream(bytes: Buffer): Readable {
	return Readable.from([bytes], { objectMode: false });
}

beforeEach(() => {
	// 1. Fresh random values per test; falso keeps them realistic enough to catch accidental string handling
	sample = {
		config: {
			serviceRole: randAlphaNumeric({ length: 40 }).join(''),
			bucket: randBucket(),
			projectId: randAlphaNumeric({ length: 10 }).join(''),
			root: randUnique() + randDirectoryPath(),
			endpoint: randDomainName(),
			tus: { chunkSize: 1024 * 1024 },
		},
		path: {
			input: randUnique() + randFilePath(),
			src: randUnique() + randFilePath(),
			dest: randUnique() + randFilePath(),
		},
		range: {
			start: randNumber(),
			end: randNumber(),
		},
		stream: new Readable(),
		text: randText(),
		file: {
			type: randFileType(),
			size: randNumber(),
			modified: randPastDate(),
		},
	};

	// 2. `@supabase/storage-js` and `undici` are mocked above, so constructing the driver only records calls and never
	//    opens a socket; no root is set, so paths pass through `fullPath` unchanged
	driver = new StorageDriverSupabase({
		serviceRole: sample.config.serviceRole,
		bucket: sample.config.bucket,
		projectId: sample.config.projectId,
	});
});

afterEach(() => {
	// 1. Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	let getClientBackup: (typeof StorageDriverSupabase.prototype)['getClient'];
	let getBucketBackup: (typeof StorageDriverSupabase.prototype)['getBucket'];
	let sampleClient: StorageClient;
	let sampleBucket: ReturnType<StorageClient['from']>;

	beforeEach(() => {
		// 1. Swap `getClient` and `getBucket` on the prototype before construction, so the constructor's own calls are
		//    observable; the originals are restored afterwards because the other describe blocks rely on them
		getClientBackup = StorageDriverSupabase.prototype['getClient'];
		sampleClient = {} as StorageClient;
		StorageDriverSupabase.prototype['getClient'] = vi.fn().mockReturnValue(sampleClient);

		getBucketBackup = StorageDriverSupabase.prototype['getBucket'];
		sampleBucket = {} as ReturnType<StorageClient['from']>;
		StorageDriverSupabase.prototype['getBucket'] = vi.fn().mockReturnValue(sampleBucket);
	});

	afterEach(() => {
		// 1. Put the real builders back, so the driver created in the outer `beforeEach` keeps calling the mocked
		//    `StorageClient` rather than the stubs of this block
		StorageDriverSupabase.prototype['getClient'] = getClientBackup;
		StorageDriverSupabase.prototype['getBucket'] = getBucketBackup;
	});

	test('Saves passed config to local property', () => {
		// 1. The config is copied with a confined root; `confinePath` leaves this sample root untouched because it has
		//    no leading slash and no `..`, so the copy must equal the input field by field
		const driver = new StorageDriverSupabase(sample.config);

		expect(driver['config']).toStrictEqual(sample.config);
	});

	test('Creates shared client', () => {
		// 1. The client is built inside the constructor, so a bad config fails early; the stub only records that call
		const driver = new StorageDriverSupabase(sample.config);
		expect(driver['getClient']).toHaveBeenCalledOnce();
		expect(driver['client']).toBe(sampleClient);
	});

	test('Defaults root to empty string', () => {
		// 1. An absent root must become the empty string, which is what Supabase expects for the top of the bucket,
		//    not `undefined` that would end up in joined object names
		expect(driver['config'].root).toBe('');
	});

	test.each([[-1], [0], [Number.NaN]])('Refuses a non-positive chunk size of %s', (chunkSize) => {
		// 1. A zero, negative or NaN size would be kept as the per-chunk bound and refuse every arriving chunk with a
		//    misleading "exceeds the chunk size limit" error; NaN slips through every comparison, which is why the
		//    check is written as `!(size > 0)`
		expect(
			() =>
				new StorageDriverSupabase({
					serviceRole: sample.config.serviceRole,
					bucket: sample.config.bucket,
					projectId: sample.config.projectId,
					tus: { chunkSize },
				}),
		).toThrowError('The supabase storage driver got a "tus.chunkSize" below 1 byte');
	});
});

describe('#getClient', () => {
	test('Throws error if serviceRole is missing', () => {
		// 1. The constructor calls `getClient`, so constructing is enough to exercise it; with a project set the
		//    endpoint check passes, so the missing key is what gets reported
		expect(() => new StorageDriverSupabase({ bucket: 'bucket', projectId: 'project', serviceRole: '' })).toThrowError(
			'The supabase storage driver needs a "serviceRole"',
		);
	});

	test('Throws error if bucket missing', () => {
		// 1. The client builds fine with a project and a key; the bucket check is the last guard and names the option
		expect(() => new StorageDriverSupabase({ bucket: '', serviceRole: 'key', projectId: 'project' })).toThrowError(
			'The supabase storage driver needs a "bucket"',
		);
	});

	test('Throws error if projectId and endpoint are both missing', () => {
		// 1. Without either the endpoint would read `https://undefined.supabase.co`, so the constructor has to refuse
		expect(() => new StorageDriverSupabase({ serviceRole: 'secret', bucket: 'bucket' })).toThrowError(
			'The supabase storage driver needs a "projectId" or an "endpoint"',
		);
	});

	test('Throws error if serviceRole is missing with a project', () => {
		// 1. With a project the endpoint check passes, so the missing key is what gets reported
		expect(() => new StorageDriverSupabase({ bucket: 'bucket', projectId: 'project', serviceRole: '' })).toThrowError(
			'The supabase storage driver needs a "serviceRole"',
		);
	});

	test('Throws error if bucket is missing with a project and a key', () => {
		// 1. The client builds fine; the bucket check is the last guard and names the option
		expect(() => new StorageDriverSupabase({ bucket: '', projectId: 'project', serviceRole: 'secret' })).toThrowError(
			'The supabase storage driver needs a "bucket"',
		);
	});

	test('Is valid if projectId is given', () => {
		// 1. A project id alone must expand to the hosted Storage API URL
		const projectId = 'project';
		const driver = new StorageDriverSupabase({ serviceRole: 'secret', bucket: 'bucket', projectId });
		expect(driver).toBeInstanceOf(StorageDriverSupabase);
		expect(driver['endpoint']).toEqual(`https://${projectId}.supabase.co/storage/v1`);
	});

	test('Is valid if endpoint is given', () => {
		// 1. A custom endpoint is used verbatim, which is what self-hosted setups rely on
		const endpoint = 'https://example.com';
		const driver = new StorageDriverSupabase({ serviceRole: 'secret', bucket: 'bucket', endpoint });
		expect(driver).toBeInstanceOf(StorageDriverSupabase);
		expect(driver['endpoint']).toEqual(endpoint);
	});

	test('Creates storage client', () => {
		// 1. Supabase needs the key in both headers: `apikey` identifies the project, the bearer token authorises
		expect(StorageClient).toHaveBeenCalledWith(`https://${sample.config.projectId}.supabase.co/storage/v1`, {
			apikey: sample.config.serviceRole,
			Authorization: `Bearer ${sample.config.serviceRole}`,
		});

		expect(driver['client']).toBeInstanceOf(StorageClient);
	});
});

describe('#fullPath', () => {
	test('Returns the input value if no root is given', () => {
		// 1. Without a root there is nothing to prefix, so the caller path is the object name as it is
		const driver = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
		});

		const result = driver['fullPath'](sample.path.input);
		expect(result).toBe(sample.path.input);
	});

	test('Returns normalized joined path', () => {
		// 1. The root is joined with a single slash, so a caller path never gets a double separator in its name
		const driver = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
			root: sample.config.root,
		});

		const result = driver['fullPath'](sample.path.input);
		expect(result).toBe(`${sample.config.root}/${sample.path.input}`);
	});

	test('Keeps a caller path under the root and drops a leading slash, like every other driver', () => {
		// 1. One driver with a root and one without, since confinement has to hold in both cases
		const rooted = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
			root: 'media',
		});

		const unrooted = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
		});

		// 2. `..` used to climb out of the root and a leading slash used to stay in the object name
		expect(rooted['fullPath']('../other/secret')).toBe('media/other/secret');
		expect(unrooted['fullPath']('../x')).toBe('x');
		expect(unrooted['fullPath']('/x')).toBe('x');
		expect(unrooted['fullPath']('')).toBe('');
	});
});

describe('#getAuthenticatedUrl', () => {
	test('Returns the url for an object with no root that requires authentication', () => {
		// 1. The URL goes through `object/authenticated`, which serves private objects to a bearer-authenticated request
		const driver = new StorageDriverSupabase({
			serviceRole: 'serviceRole',
			bucket: 'bucket',
			projectId: 'projectId',
		});

		const result = driver['getAuthenticatedUrl']('testing.png');

		expect(result).toBe('https://projectId.supabase.co/storage/v1/object/authenticated/bucket/testing.png');
	});

	test('Returns the url for an object that requires authentication', () => {
		// 1. The root sits between the bucket and the object name, since it is part of the object name in Supabase
		const driver = new StorageDriverSupabase({
			serviceRole: 'serviceRole',
			bucket: 'bucket',
			projectId: 'projectId',
			root: 'testing',
		});

		const result = driver['getAuthenticatedUrl']('testing.png');

		expect(result).toBe('https://projectId.supabase.co/storage/v1/object/authenticated/bucket/testing/testing.png');
	});

	test.each([
		['report?v=1.pdf', 'report%3Fv%3D1.pdf'],
		['report#v1.pdf', 'report%23v1.pdf'],
	])('Percent-encodes the object name %s so it addresses one object', (input, encoded) => {
		// 1. A raw `?` would read as the start of the query string and a raw `#` as the fragment, so the endpoint
		//    would be asked for a different object than the caller named
		const driver = new StorageDriverSupabase({
			serviceRole: 'serviceRole',
			bucket: 'bucket',
			projectId: 'projectId',
		});

		const result = driver['getAuthenticatedUrl'](input);

		expect(result).toBe(`https://projectId.supabase.co/storage/v1/object/authenticated/bucket/${encoded}`);
	});
});

describe('#read', () => {
	let rootEndpoint: string;
	let endpoint: string;

	beforeEach(() => {
		// 1. Stub the URL builder and give `fetch` a successful streaming response, so each test only varies the
		//    headers it cares about
		rootEndpoint = `https://projectId.supabase.co/storage/v1/object/authenticated/bucket/testing/${sample.path.input}.png`;
		endpoint = `https://projectId.supabase.co/storage/v1/object/authenticated/bucket/${sample.path.input}.png`;
		vi.mocked(fetch).mockReturnValue({ status: 200, body: new ReadableStream() } as unknown as Promise<Response>);
		driver['getAuthenticatedUrl'] = vi.fn().mockReturnValue(endpoint);
	});

	test('Uses getAuthenticatedUrl to get endpoint when no root is set', async () => {
		// 1. The request must carry the service-role key in both headers and nothing else: no range header when none
		//    was asked for
		await driver.read(sample.path.input);

		expect(driver['getAuthenticatedUrl']).toHaveBeenCalledWith(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
			},
			method: 'GET',
		});
	});

	test('Uses getAuthenticatedUrl to get endpoint when a root is set', async () => {
		// 1. The root only changes the URL the builder answers with; the request itself stays the same
		driver['getAuthenticatedUrl'] = vi.fn().mockReturnValue(rootEndpoint);

		await driver.read(sample.path.input);

		expect(driver['getAuthenticatedUrl']).toHaveBeenCalledWith(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(rootEndpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting start range offset', async () => {
		// 1. An open end must produce `bytes=N-`, which the server reads as "from N to the end"
		await driver.read(sample.path.input, { range: { start: sample.range.start } });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
				Range: `bytes=${sample.range.start}-`,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting end range offset', async () => {
		// 1. An open start means the first bytes up to `end`, `bytes=0-N`; `bytes=-N` would ask for the last N bytes
		await driver.read(sample.path.input, { range: { end: sample.range.end } });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
				Range: `bytes=0-${sample.range.end}`,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting start and end range offset', async () => {
		// 1. Both bounds given go out as `bytes=start-end`, the inclusive form HTTP expects
		await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
				Range: `bytes=${sample.range.start}-${sample.range.end}`,
			},
			method: 'GET',
		});
	});

	test('Throws an error naming the status and the reason for an error status', async () => {
		// 1. A 403 with a JSON body: the status must survive in the message, so a denied read is not mistaken for a
		//    missing stream, and the body, which is Supabase's own explanation, must come along as the cause
		const reason = '{"statusCode":"403","error":"Unauthorized","message":"invalid signature"}';
		const text = vi.fn().mockResolvedValue(reason);

		vi.mocked(fetch).mockReturnValue({
			status: 403,
			body: new ReadableStream(),
			text,
		} as unknown as Promise<Response>);

		await expect(driver.read(sample.path.input, { range: sample.range })).rejects.toMatchObject({
			message: `Couldn't read file "${sample.path.input}" (403)`,
			cause: reason,
		});

		// 2. Reading the body is what releases the connection, so it has to be read rather than left dangling
		expect(text).toHaveBeenCalledOnce();
	});

	test('Throws an error naming the status without a cause when the error response has no body', async () => {
		// 1. An empty body must not become an empty-string cause; the status alone is the whole story
		vi.mocked(fetch).mockReturnValue({
			status: 500,
			body: null,
			text: vi.fn().mockResolvedValue(''),
		} as unknown as Promise<Response>);

		const error: unknown = await driver.read(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(`Couldn't read file "${sample.path.input}" (500)`);
		expect((error as Error).cause).toBeUndefined();
	});

	test('Throws an error naming the status when the error body cannot be read', async () => {
		// 1. A body that fails to read must not replace the read error with a body error; the status still reports
		vi.mocked(fetch).mockReturnValue({
			status: 502,
			body: new ReadableStream(),
			text: vi.fn().mockRejectedValue(new Error('aborted')),
		} as unknown as Promise<Response>);

		await expect(driver.read(sample.path.input)).rejects.toThrowError(
			`Couldn't read file "${sample.path.input}" (502)`,
		);
	});

	test('Throws StorageFileNotFoundError when the object is missing', async () => {
		// 1. A 404 is the error every backend shares; any other error status stays the generic one. The body is
		//    cancelled rather than read, since an unread body holds its connection open
		const cancel = vi.fn(async () => {});
		vi.mocked(fetch).mockReturnValue({ status: 404, body: { cancel } } as unknown as Promise<Response>);

		await expect(driver.read(sample.path.input)).rejects.toBeInstanceOf(StorageFileNotFoundError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	test('Throws an error when returned stream is not a readable stream', async () => {
		// 1. A successful status without a body is the one case that keeps the "no stream" wording: nothing failed,
		//    there is just nothing to stream
		vi.mocked(fetch).mockReturnValue({ status: 200, body: undefined } as unknown as Promise<Response>);

		await expect(driver.read(sample.path.input, { range: sample.range })).rejects.toThrowError(
			new Error(`No stream returned for file "${sample.path.input}"`),
		);
	});

	test('Returns stream', async () => {
		// 1. The Web stream from `fetch` must come back converted, since callers expect a Node readable
		const stream = await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				apikey: sample.config.serviceRole,
				Range: `bytes=${sample.range.start}-${sample.range.end}`,
			},
			method: 'GET',
		});

		expect(stream).toBeInstanceOf(Readable);
	});
});

describe('#stat', () => {
	test('Returns the size/modified from metadata', async () => {
		// 1. The bucket handle is replaced per test: only `list` is needed, and its answer is the whole fixture
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [fileEntry(basename(sample.path.input), sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		const stat = await driver.stat(sample.path.input);

		expect(stat).toEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});

		// 2. The lookup must query the parent folder and search for the base name, not list the whole bucket; the
		//    page is the API default rather than one entry, since the search is a prefix filter and the exact entry
		//    need not come first
		expect(driver['bucket'].list).toHaveBeenCalledWith(dirname(sample.path.input), {
			limit: 100,
			offset: 0,
			search: basename(sample.path.input),
		});
	});

	test('Uses the configured root directory', async () => {
		// 1. The root becomes part of the queried folder, since it is part of the object name in Supabase
		driver['config'].root = 'root';

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [fileEntry(basename(sample.path.input), sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		const stat = await driver.stat(sample.path.input);

		expect(stat).toEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});

		expect(driver['bucket'].list).toHaveBeenCalledWith(join('root', dirname(sample.path.input)), {
			limit: 100,
			offset: 0,
			search: basename(sample.path.input),
		});
	});

	test('Uses empty string instead of "." when root is the empty string', async () => {
		// 1. `join('', '')` yields `.`, which Supabase would treat as a literal folder name
		const filename = 'test.png';

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [fileEntry(filename, sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		await driver.stat(filename);

		expect(driver['bucket'].list).toHaveBeenCalledWith('', {
			limit: 100,
			offset: 0,
			search: filename,
		});
	});

	test('Picks the entry with exactly the requested name over folders and longer names listed before it', async () => {
		// 1. Supabase's search is a prefix filter and lists folders first, so a folder `report.pdf.versions` and a
		//    file `report.pdf.bak` come back ahead of `report.pdf`; the exact file is the one whose size must be
		//    reported
		const other = randNumber();

		driver['bucket'] = {
			list: vi.fn().mockResolvedValue({
				data: [
					folderEntry('report.pdf.versions'),
					folderEntry('report.pdf'),
					fileEntry('report.pdf.bak', other, randPastDate()),
					fileEntry('report.pdf', sample.file.size, sample.file.modified),
				],
				error: null,
			}),
		} as unknown as BucketApi;

		const stat = await driver.stat('report.pdf');

		expect(stat).toEqual({ size: sample.file.size, modified: sample.file.modified });
	});

	test('Throws the kit error when only longer names or a folder of that name match', async () => {
		// 1. `report.pdf.bak` and a folder `report.pdf` both satisfy the search filter, yet neither is the object;
		//    answering with the folder's zero size or the other file's size would report a missing object as present
		driver['bucket'] = {
			list: vi.fn().mockResolvedValue({
				data: [folderEntry('report.pdf'), fileEntry('report.pdf.bak', sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		const error: unknown = await driver.stat('report.pdf').catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: 'report.pdf' } });
	});

	test('Throws the kit error when only a name differing in case matches', async () => {
		// 1. The search filter is case-insensitive while object names are not: `A.PNG` is not `a.png`
		driver['bucket'] = {
			list: vi.fn().mockResolvedValue({
				data: [fileEntry('A.PNG', sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		await expect(driver.stat('a.png')).rejects.toBeInstanceOf(StorageFileNotFoundError);
	});

	test('Walks the following page when a full page holds only other matches', async () => {
		// 1. A hundred files whose names start with the requested one fill the first page; the exact entry is on the
		//    second, so a lookup that stopped at one page would report it missing
		const filler = Array.from({ length: 100 }, (_, i) => fileEntry(`a.png.${i}`, randNumber(), randPastDate()));

		driver['bucket'] = {
			list: vi
				.fn()
				.mockResolvedValueOnce({ data: filler, error: null })
				.mockResolvedValueOnce({
					data: [fileEntry('a.png', sample.file.size, sample.file.modified)],
					error: null,
				}),
		} as unknown as BucketApi;

		const stat = await driver.stat('a.png');

		expect(stat).toEqual({ size: sample.file.size, modified: sample.file.modified });

		// 2. The second request continues where the first ended, so no entry is skipped or listed twice
		expect(driver['bucket'].list).toHaveBeenCalledTimes(2);
		expect(driver['bucket'].list).toHaveBeenLastCalledWith('', { limit: 100, offset: 100, search: 'a.png' });
	});

	test('Throws the kit error when no file is returned by list', async () => {
		// 1. An empty listing is how Supabase says "missing"; it becomes the error every backend shares
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [],
				error: null,
			}),
		} as unknown as BucketApi;

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input } });
	});

	test('Throws an error naming the file when the entry carries no metadata, instead of reporting zero size and the epoch', async () => {
		// 1. The API can report a file entry whose metadata is absent; the S3, GCS and Azure drivers refuse a stat
		//    response missing its fields, so this driver does the same rather than handing out `0` / the epoch under
		//    the `Stat` type
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [{ name: basename(sample.path.input), id: randUnique(), metadata: null }],
				error: null,
			}),
		} as unknown as BucketApi;

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}": the listing entry has no size or modification time`,
		);
	});

	test('Throws an error naming the file when the entry metadata has no size or modification time', async () => {
		// 1. A metadata map without the fields is as broken as an absent one: without both values there is no stat to
		//    report, only a guess
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [{ name: basename(sample.path.input), id: randUnique(), metadata: {} }],
				error: null,
			}),
		} as unknown as BucketApi;

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(
			`No stat returned for file "${sample.path.input}": the listing entry has no size or modification time`,
		);
	});

	test('Throws an error wrapping the storage error if the lookup failed', async () => {
		// 1. A failed lookup is not the same answer as an empty one, so the failure has to reach the caller instead of
		//    being reported as a missing file; it is wrapped with the path like every other failure of this driver
		const cause = new Error('Service unavailable');

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: null,
				error: cause,
			}),
		} as unknown as BucketApi;

		await expect(driver.stat(sample.path.input)).rejects.toMatchObject({
			message: `Error looking up file "${sample.path.input}"`,
			cause,
		});
	});
});

describe('#exists', () => {
	test('Returns true if the file is returned by list', async () => {
		// 1. An entry with exactly the requested name and a non-null id is proof of existence
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [fileEntry(basename(sample.path.input), sample.file.size, sample.file.modified)],
				error: null,
			}),
		} as unknown as BucketApi;

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(true);
	});

	test('Returns false if no file is returned by list', async () => {
		// 1. An empty listing is how Supabase says "missing"
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [],
				error: null,
			}),
		} as unknown as BucketApi;

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(false);
	});

	test('Returns false when only longer names, a folder of that name or another case match', async () => {
		// 1. Every entry here satisfies Supabase's prefix search, none is the object: a `true` would make a caller
		//    skip an upload or serve a link to nothing
		driver['bucket'] = {
			list: vi.fn().mockResolvedValue({
				data: [
					folderEntry('report.pdf'),
					fileEntry('report.pdf.bak', sample.file.size, sample.file.modified),
					fileEntry('REPORT.PDF', sample.file.size, sample.file.modified),
				],
				error: null,
			}),
		} as unknown as BucketApi;

		await expect(driver.exists('report.pdf')).resolves.toBe(false);
	});

	test('Throws an error wrapping the storage error if the lookup failed', async () => {
		// 1. Reporting a failed request as "not found" would make callers act on a wrong answer
		const cause = new Error('Service unavailable');

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: null,
				error: cause,
			}),
		} as unknown as BucketApi;

		await expect(driver.exists(sample.path.input)).rejects.toMatchObject({
			message: `Error looking up file "${sample.path.input}"`,
			cause,
		});
	});
});

describe('#move', () => {
	beforeEach(() => {
		// 1. The copy goes through the mocked `undici` fetch; the source removal through the bucket handle
		vi.mocked(fetch).mockResolvedValue(new globalThis.Response('{"Key":"x"}', { status: 200 }) as never);

		driver['bucket'] = { remove: vi.fn(async () => ({ data: [], error: null })) } as unknown as BucketApi;
	});

	test('Copies with upsert onto the destination and then removes the source', async () => {
		await driver.move(sample.path.input, 'new/path');

		// 1. The native move refuses an existing destination, so the move is an upserting copy and a removal
		const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, SentInit];

		expect(url).toBe(`https://${sample.config.projectId}.supabase.co/storage/v1/object/copy`);
		expect(init.headers).toMatchObject({ 'x-upsert': 'true' });

		expect(JSON.parse(init.body)).toStrictEqual({
			bucketId: sample.config.bucket,
			sourceKey: sample.path.input,
			destinationKey: 'new/path',
		});

		expect(driver['bucket'].remove).toHaveBeenCalledWith([sample.path.input]);
	});

	test.each([
		['a.png', 'a.png'],
		['a.png', './a.png'],
	])('Does nothing when "%s" and "%s" name the same object', async (src, dest) => {
		await driver.move(src, dest);

		// 1. The upserting copy would succeed onto itself, so removing the source would delete the only copy
		expect(fetch).not.toHaveBeenCalled();
		expect(driver['bucket'].remove).not.toHaveBeenCalled();
	});

	test('Keeps the source and throws when the copy fails', async () => {
		// 1. A refused copy must not be followed by removing the source, or the object would be lost
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', {
				status: 404,
			}) as never,
		);

		await expect(driver.move('a.png', 'b.png')).rejects.toMatchObject({
			message: 'Error moving file "a.png" to "b.png"',
		});

		expect(driver['bucket'].remove).not.toHaveBeenCalled();
	});

	test('Throws when the source removal fails instead of resolving', async () => {
		// 1. storage-js answers a failure as `{ error }`; a move whose source is still there must not read as done
		const cause = new Error('Access denied');
		driver['bucket'] = { remove: vi.fn(async () => ({ data: null, error: cause })) } as unknown as BucketApi;

		await expect(driver.move('a.png', 'b.png')).rejects.toMatchObject({
			message: 'Error moving file "a.png" to "b.png"',
			cause: { cause },
		});
	});
});

describe('#copy', () => {
	test('Posts the copy with upsert, so an existing destination is replaced', async () => {
		vi.mocked(fetch).mockResolvedValue(new globalThis.Response('{"Key":"x"}', { status: 200 }) as never);

		await driver.copy(sample.path.input, 'new/path');

		// 1. Both names go through `fullPath`, which is the identity without a root; `x-upsert` is what storage-js
		//    leaves out and what makes Supabase overwrite instead of answering 409
		const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, SentInit];

		expect(url).toBe(`https://${sample.config.projectId}.supabase.co/storage/v1/object/copy`);
		expect(init.method).toBe('POST');

		expect(init.headers).toMatchObject({
			'x-upsert': 'true',
			authorization: `Bearer ${sample.config.serviceRole}`,
			apikey: sample.config.serviceRole,
		});

		expect(JSON.parse(init.body)).toStrictEqual({
			bucketId: sample.config.bucket,
			sourceKey: sample.path.input,
			destinationKey: 'new/path',
		});
	});

	test('Throws when Supabase refuses the copy instead of resolving', async () => {
		// 1. An error status must not read as a copy that happened
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', {
				status: 404,
			}) as never,
		);

		await expect(driver.copy('a.png', 'b.png')).rejects.toMatchObject({
			message: 'Error copying file "a.png" to "b.png"',
			cause: expect.any(ProviderCallError),
		});
	});
});

describe('#write', () => {
	beforeEach(() => {
		// 1. A successful upload is the default; the failure test overrides the handle
		driver['bucket'] = {
			upload: vi.fn().mockResolvedValue({ data: null, error: null }),
		} as unknown as BucketApi;
	});

	test('Passes streams to body as is', async () => {
		// 1. Without a type the driver sends a generic binary content type, since the endpoint rejects an empty one;
		//    the other options are fixed by the driver
		await driver.write(sample.path.input, sample.stream);

		expect(driver['bucket'].upload).toHaveBeenCalledWith(sample.path.input, sample.stream, {
			cacheControl: '3600',
			contentType: 'application/octet-stream',
			duplex: 'half',
			upsert: true,
		});
	});

	test('Ensures input is passed to fullPath', async () => {
		// 1. Stubbing `fullPath` shows the caller path reaches it unchanged, so the root is applied on every write
		driver['fullPath'] = vi.fn();

		await driver.write(sample.path.input, sample.stream);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Optionally sets ContentType', async () => {
		// 1. A given type is stored as the object's content type, so downloads are served with it
		await driver.write(sample.path.input, sample.stream, sample.file.type);

		expect(driver['bucket'].upload).toHaveBeenCalledWith(sample.path.input, sample.stream, {
			cacheControl: '3600',
			contentType: sample.file.type,
			duplex: 'half',
			upsert: true,
		});
	});

	test('Throws error when upload fails', async () => {
		// 1. The client reports failures as a return value, so the driver has to turn it into a thrown error
		const uploadError = new Error('Upload failed');

		driver['bucket'] = {
			upload: vi.fn().mockResolvedValue({ data: null, error: uploadError }),
		} as unknown as BucketApi;

		await expect(driver.write(sample.path.input, sample.stream)).rejects.toThrow(
			new Error(`Error uploading file "${sample.path.input}"`, { cause: uploadError }),
		);
	});
});

describe('#delete', () => {
	test('Ensures input is passed to fullPath', async () => {
		// 1. Stubbing `fullPath` shows the caller path reaches it unchanged, so the root is applied on every removal
		driver['bucket'] = {
			remove: vi.fn(async () => ({ data: [], error: null })),
		} as unknown as BucketApi;

		driver['fullPath'] = vi.fn();

		await driver.delete(sample.path.input);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Throws when the client reports the removal failed instead of resolving', async () => {
		// 1. storage-js answers a failure as `{ error }`; an object that is still there must not read as deleted
		const cause = new Error('jwt expired');
		driver['bucket'] = { remove: vi.fn(async () => ({ data: null, error: cause })) } as unknown as BucketApi;

		await expect(driver.delete('a.png')).rejects.toMatchObject({
			message: 'Error deleting file "a.png"',
			cause,
		});
	});
});

describe('#list', () => {
	test('Constructs list objects params based on input prefix', async () => {
		// 1. A prefix without a trailing slash is split into the folder to query and the name fragment to search
		const sampleFile = randFileName();
		const sampleDirectory = randDirectoryPath();
		const fullSample = `${sampleDirectory}/${sampleFile}`;

		// 2. The bucket handle is replaced inline: only `list` is needed, and an empty page ends the walk at once
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({ data: [], error: null }),
		} as unknown as BucketApi;

		// 3. Pull one item to trigger the first request; the generator is lazy until iterated. The prefix goes through
		//    `fullPath`, which confines it under the root, so a leading slash of the sample directory is gone
		await driver.list(fullSample)[Symbol.asyncIterator]().next();

		expect(driver['bucket'].list).toHaveBeenCalledWith(sampleDirectory.replace(/^\/+/, ''), {
			search: sampleFile,
			limit: 1000,
			offset: 0,
		});
	});

	test('Lists the whole root as a folder, not as a search for names starting with it', async () => {
		// 1. `media` as a search term would match `media-archive` too; the folder itself is what an empty prefix means
		const rooted = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
			root: 'media',
		});

		rooted['bucket'] = { list: vi.fn().mockResolvedValue({ data: [], error: null }) } as unknown as BucketApi;

		// 2. Both the empty prefix and a caller folder must be queried with their trailing slash and no search term
		await rooted.list('')[Symbol.asyncIterator]().next();
		expect(rooted['bucket'].list).toHaveBeenCalledWith('media/', { search: '', limit: 1000, offset: 0 });

		await rooted.list('avatars/')[Symbol.asyncIterator]().next();
		expect(rooted['bucket'].list).toHaveBeenCalledWith('media/avatars/', { search: '', limit: 1000, offset: 0 });
	});

	test('Yields file name omitting root if prefix is the full file path', async () => {
		// 1. Outcome 1 from the driver docs: a non-null id marks a file, which is yielded with the root stripped
		const sampleRoot = randDirectoryPath();
		const sampleFile = randFileName();
		const sampleFull = `${sample.path.input}/${sampleFile}`;

		driver['bucket'] = {
			list: vi.fn().mockResolvedValueOnce({
				data: [
					{
						name: sampleFile,
						id: randUnique(),
					},
				],
				error: null,
			}),
		} as unknown as BucketApi;

		driver['config'].root = sampleRoot;

		// 2. Drain the generator, since a listing is only observable through what it yields
		const iterator = driver.list(sampleFull);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output).toStrictEqual([sampleFull]);
	});

	test('Yields file name omitting root if prefix is the parent directory', async () => {
		// 1. Outcome 2: the first listing returns the folder itself (null id), the second its contents
		const sampleRoot = randDirectoryPath();
		const sampleFile = randFileName();
		const sampleParentDir = randUnique();
		const sampleInput = `${sample.path.input}/${sampleParentDir}`;
		const sampleFull = `${sampleInput}/${sampleFile}`;

		driver['bucket'] = {
			list: vi
				.fn()
				.mockResolvedValueOnce({
					data: [
						{
							name: sampleParentDir,
							id: null,
						},
					],
					error: null,
				})
				.mockResolvedValueOnce({
					data: [
						{
							name: sampleFile,
							id: randUnique(),
						},
					],
					error: null,
				}),
		} as unknown as BucketApi;

		driver['config'].root = sampleRoot;

		// 2. Drain the generator; the folder entry itself must not be yielded, only the file found by descending
		const iterator = driver.list(sampleInput);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(driver['bucket'].list).toHaveBeenCalledTimes(2);
		expect(output).toStrictEqual([sampleFull]);
	});

	test('Yields file name omitting root if prefix is part of the file name', async () => {
		// 1. Outcome 3: a partial name matches several files, all of which are yielded
		const sampleRoot = randDirectoryPath();
		const sampleFilePrefix = randFileName();
		const sampleFiles = [1, 2, 3].map((i) => `${sampleFilePrefix}_postfix${i}`);
		const sampleInput = `${sample.path.input}/${sampleFilePrefix}`;
		const sampleFilesFull = sampleFiles.map((name) => `${sample.path.input}/${name}`);

		driver['bucket'] = {
			list: vi.fn().mockResolvedValueOnce({
				data: sampleFiles.map((name) => ({
					name,
					id: randUnique(),
				})),
				error: null,
			}),
		} as unknown as BucketApi;

		driver['config'].root = sampleRoot;

		// 2. Drain the generator; the matches must come out in listing order with the root stripped
		const iterator = driver.list(sampleInput);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(sampleFilesFull);
	});

	test('Skips entries the search matched only case-insensitively or through a wildcard', async () => {
		// 1. Supabase answers `report` with `Report.pdf` and `a_b` style fragments with any character in place of `_`;
		//    only the exact-prefix file and folder belong to the prefix, the others must be neither yielded nor listed
		driver['bucket'] = {
			list: vi.fn(async (path: string, options?: { search?: string }): Promise<ListAnswer> => {
				// 1. The root is searched for the fragment and answers with exact and false matches alike
				if (path === '' && options?.search === 'rep_rt')
					return {
						data: [
							{ name: 'rep_rt.pdf', id: randUnique() },
							{ name: 'Rep_rt.pdf', id: randUnique() },
							{ name: 'repxrt.pdf', id: randUnique() },
							{ name: 'rep_rts', id: null },
							{ name: 'REP_RTS', id: null },
						],
						error: null,
					};

				// 2. Only the exact-prefix folder may be descended into
				if (path === 'rep_rts/' && options?.search === '')
					return { data: [{ name: 'x.txt', id: randUnique() }], error: null };

				throw Error();
			}),
		} as unknown as BucketApi;

		driver['config'].root = '';

		// 2. Drain the generator, since a listing is only observable through what it yields
		const output: string[] = [];

		for await (const filepath of driver.list('rep_rt')) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(['rep_rt.pdf', 'rep_rts/x.txt']);
		expect(driver['bucket'].list).toHaveBeenCalledTimes(2);
	});

	test('Recursively fetches all nested directories and yields only the files', async () => {
		// 1. Fixture layout: the prefix folder holds one file and one folder with a nested file, so the listing has to
		//    descend exactly once and yield two files
		const sampleRoot = randUnique() + randDirectoryPath();
		const samplePrefixBase = randUnique() + randDirectoryPath();
		const samplePrefixLastDir = randUnique();
		const samplePrefix = `${samplePrefixBase}/${samplePrefixLastDir}`;

		const sampleDirectory = randUnique();
		const sampleFile = randFileName();
		const sampleFileNested = randFileName();

		const fullSampleDirectory = `${samplePrefix}/${sampleDirectory}`;
		const fullSampleFile = `${samplePrefix}/${sampleFile}`;
		const fullSampleFileNested = `${fullSampleDirectory}/${sampleFileNested}`;

		// 2. Route each listing call by the exact folder and search the driver is expected to send; any other call is
		//    a wrong query and fails the test by throwing
		driver['bucket'] = {
			list: vi.fn(async (path: string, options?: { search?: string }): Promise<ListAnswer> => {
				// 1. The parent is queried with the last segment as the search term and answers with the folder itself
				if (path === `${sampleRoot}/${samplePrefixBase}` && options?.search === samplePrefixLastDir)
					return { data: [{ name: samplePrefixLastDir, id: null }], error: null };

				// 2. The prefix folder is then listed whole and answers with its file and its sub-folder
				if (path === `${sampleRoot}/${samplePrefix}/` && options?.search === '')
					return {
						data: [
							{ name: sampleDirectory, id: null },
							{ name: sampleFile, id: randUnique() },
						],
						error: null,
					};

				// 3. The sub-folder is listed whole in turn and answers with the nested file
				if (path === `${sampleRoot}/${fullSampleDirectory}/` && options?.search === '')
					return {
						data: [{ name: sampleFileNested, id: randUnique() }],
						error: null,
					};

				throw Error();
			}),
		} as unknown as BucketApi;

		driver['config'].root = sampleRoot;

		// 3. Drain the generator, since a listing is only observable through what it yields
		const iterator = driver.list(samplePrefix);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		// 4. Three queries: the parent, the prefix folder and the nested folder; folders are descended in listing
		//    order, so the nested file comes out before the sibling file
		expect(driver['bucket'].list).toHaveBeenCalledTimes(3);
		expect(output).toStrictEqual([fullSampleFileNested, fullSampleFile]);
	});

	test('Continuously fetches until all pages are returned', async () => {
		// 1. A full page of 1000 must trigger a second request; the short second page ends the loop
		const firstContents = Array.from({ length: 1000 }, () => ({
			name: `${basename(sample.path.input)}-${randUnique()}`,
		}));

		const secondContents = Array.from({ length: 256 }, () => ({
			name: `${basename(sample.path.input)}-${randUnique()}`,
		}));

		// 2. The bucket handle is replaced inline with a `list` that answers the two pages in order
		driver['bucket'] = {
			list: vi
				.fn()
				.mockResolvedValueOnce({
					data: firstContents,
					error: null,
				})
				.mockResolvedValueOnce({
					data: secondContents,
					error: null,
				}),
		} as unknown as BucketApi;

		// 3. Drain the generator; every entry of both pages must come out
		const iterator = driver.list(sample.path.input);

		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output.length).toBe(1256);
	});

	test('Throws when the first page fails instead of ending the listing as empty', async () => {
		// 1. storage-js reports a rotated key or an outage as `{ data: null, error }`; a listing that ends quietly
		//    would let a cleanup job conclude the prefix is empty
		const cause = new Error('Invalid JWT');

		driver['bucket'] = { list: vi.fn().mockResolvedValue({ data: null, error: cause }) } as unknown as BucketApi;

		const output: string[] = [];

		// 2. Draining has to reject with the full prefix that was queried and the storage error as the cause, and
		//    nothing may have been yielded before that
		await expect(async () => {
			// 1. Collect everything, so a yield before the failure would show up
			for await (const filepath of driver.list(sample.path.input)) {
				output.push(filepath);
			}
		}).rejects.toMatchObject({
			message: `Error listing prefix "${sample.path.input}"`,
			cause,
		});

		expect(output).toStrictEqual([]);
	});

	test('Throws when a later page fails instead of ending the listing early', async () => {
		// 1. A full first page followed by a failed second one: what was yielded stays yielded, the failure must still
		//    reach the caller rather than pass for the end of the listing
		const firstContents = Array.from({ length: 1000 }, () => ({
			name: `${basename(sample.path.input)}-${randUnique()}`,
		}));

		const cause = new Error('Service unavailable');

		driver['bucket'] = {
			list: vi
				.fn()
				.mockResolvedValueOnce({ data: firstContents, error: null })
				.mockResolvedValueOnce({ data: null, error: cause }),
		} as unknown as BucketApi;

		const output: string[] = [];

		// 2. Collect what comes through before the failure, so the truncation point is observable
		await expect(async () => {
			// 1. Every yield lands in the outer array, which survives the rejection
			for await (const filepath of driver.list(sample.path.input)) {
				output.push(filepath);
			}
		}).rejects.toMatchObject({
			message: `Error listing prefix "${sample.path.input}"`,
			cause,
		});

		expect(output.length).toBe(1000);
	});

	test('Throws when a page carries neither data nor an error', async () => {
		// 1. An answer without data and without an error breaks the client's contract; it must not pass for an empty
		//    prefix, and without a storage error there is no cause to attach
		driver['bucket'] = { list: vi.fn().mockResolvedValue({ data: null, error: null }) } as unknown as BucketApi;

		const error: unknown = await driver
			.list(sample.path.input)
			[Symbol.asyncIterator]()
			.next()
			.catch((error: unknown) => error);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(`Error listing prefix "${sample.path.input}"`);
		expect((error as Error).cause).toBeUndefined();
	});
});

describe('#call', () => {
	/**
	 * The URL and init of the one request made.
	 *
	 * @returns What `fetch` was called with.
	 */
	const request = (): [string, { method: string; headers: Record<string, string>; body?: unknown }] =>
		vi.mocked(fetch).mock.calls[0] as never;

	beforeEach(() => {
		// 1. The mocked `undici` fetch answers with a real response, so `request()` reads it as it would Supabase's
		vi.mocked(fetch).mockResolvedValue(new globalThis.Response('[{"id":"media"}]', { status: 200 }) as never);
	});

	test('Requests a path under the Storage API with the service-role key and the query of a GET', async () => {
		// 1. The key goes as bearer token and `apikey`, the way `read()` sends it; the parameters into the query
		const result = await driver.call('GET /object/info/{bucket}/a.png', { download: true });

		const [url, init] = request();

		expect(url).toBe(
			`https://${sample.config.projectId}.supabase.co/storage/v1/object/info/${sample.config.bucket}/a.png?download=true`,
		);

		expect(init.method).toBe('GET');

		expect(init.headers).toMatchObject({
			authorization: `Bearer ${sample.config.serviceRole}`,
			apikey: sample.config.serviceRole,
		});

		expect(result.data).toEqual([{ id: 'media' }]);
	});

	test('Fills a placeholder from the parameters, encoded, and does not send that parameter again', async () => {
		// 1. `{id}` takes the `id` parameter; a `/` in it cannot reshape the path, and only the rest is the query
		await driver.call('GET /bucket/{id}', { id: 'a/b c', verbose: 1 });

		const url = new URL(request()[0]);

		expect(url.pathname).toBe('/storage/v1/bucket/a%2Fb%20c');
		expect(url.search).toBe('?verbose=1');
	});

	test('Refuses a placeholder nobody filled before any request', async () => {
		// 1. Sent, `{id}` would reach Supabase as `%7Bid%7D`
		await expect(driver.call('GET /bucket/{id}')).rejects.toThrow('needs a "id" parameter');

		expect(fetch).not.toHaveBeenCalled();
	});

	test('Answers with the status, the headers lower-cased and the body', async () => {
		// 1. A response header, read by its lower-case name
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('[]', {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
			}) as never,
		);

		const result = await driver.call('GET /bucket');

		expect(result).toEqual({
			status: 200,
			headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' },
			data: [],
		});
	});

	test('Sends the parameters of a POST as JSON to a custom endpoint, with the headers of the caller', async () => {
		// 1. A self-hosted endpoint is the root; the caller's headers go over the driver's
		driver = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: 'https://storage.example.com/storage/v1',
		});

		await driver.call('POST /object/sign/{bucket}/a.png', { expiresIn: 60 }, { headers: { 'X-Upsert': 'true' } });

		const [url, init] = request();

		expect(url).toBe(`https://storage.example.com/storage/v1/object/sign/${sample.config.bucket}/a.png`);
		expect(init.body).toBe('{"expiresIn":60}');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-upsert': 'true' });
	});

	test('Hands a file among the parameters to undici as its own FormData', async () => {
		// 1. The global `FormData` httpCall builds is copied into `undici`'s, stubbed so its fields can be asserted
		const form = { append: vi.fn() };
		vi.mocked(FormData).mockReturnValue(form as unknown as FormData);

		await driver.call('POST /object/{bucket}/a.txt', { file: new File(['x'], 'a.txt') });

		expect(request()[1].body).toBe(form);
		expect(form.append).toHaveBeenCalledWith('file', expect.any(File));
	});

	test('Hands undici redirect: manual, so a redirect is never followed with the credentials', async () => {
		// 1. `httpCall` follows redirects itself and drops the credentials off the origin; undici must not do it first
		await driver.call('GET /bucket');

		expect(request()[1]).toMatchObject({ redirect: 'manual' });
	});

	test('Refuses a full URL on a foreign host before any request', async () => {
		// 1. The service-role key would go wherever the URL points
		await expect(driver.call('GET https://evil.example/bucket')).rejects.toThrow('not on a host of this provider');

		expect(fetch).not.toHaveBeenCalled();
	});

	test('Turns an error status into a ProviderCallError without the service-role key', async () => {
		// 1. Supabase's `{ statusCode, error, message }` reaches the message; the key never does
		vi.mocked(fetch).mockResolvedValue(
			new globalThis.Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', {
				status: 404,
			}) as never,
		);

		const error = await driver.call('GET /bucket/nope').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ProviderCallError);

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toMatchObject({
			provider: 'supabase',
			method: 'GET /bucket/nope',
			status: 404,
		});

		expect((error as Error).message).toContain('Bucket not found');
		expect((error as Error).message).not.toContain(sample.config.serviceRole);
	});

	test('Turns a 429 into a HitRateLimitError', async () => {
		// 1. Supabase asking to slow down becomes the kit's rate-limit error
		vi.mocked(fetch).mockResolvedValue(new globalThis.Response('', { status: 429 }) as never);

		await expect(driver.call('GET /bucket')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Gives up at the timeout of the caller', async () => {
		// 1. A request that never answers ends at the deadline
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
		);

		await expect(driver.call('GET /bucket', {}, { timeout: 5 })).rejects.toMatchObject({ name: 'TimeoutError', ms: 5 });
	});
});

describe('#tusExtensions', () => {
	test('Advertises creation, termination and expiration', () => {
		// 1. Exactly what Supabase's own TUS endpoint supports; advertising more would promise what the backend
		//    cannot honour
		expect(driver.tusExtensions).toStrictEqual(['creation', 'termination', 'expiration']);
	});
});

describe('#getResumableUrl', () => {
	test('Points at the resumable endpoint of the Storage API', () => {
		// 1. The bucket and object name travel in the TUS metadata, so the URL is the bare endpoint
		expect(driver['getResumableUrl']()).toBe(
			`https://${sample.config.projectId}.supabase.co/storage/v1/upload/resumable`,
		);
	});
});

describe('#createChunkedUpload', () => {
	test('Passes the context through untouched', async () => {
		// 1. The TUS upload is created lazily by the first `writeChunk`, so there is nothing to set up on Supabase's
		//    side and the client's metadata must survive unchanged
		const context = { size: sample.file.size, metadata: { contentType: sample.file.type } };

		const result = await driver.createChunkedUpload(sample.path.input, context);

		expect(result).toBe(context);
		expect(result.metadata).toStrictEqual({ contentType: sample.file.type });
	});
});

describe('#writeChunk', () => {
	let uploadUrl: string;

	let mockUpload: {
		url: string | null;
		start: ReturnType<typeof vi.fn>;
		resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
	};

	let captured: { source: Readable; options: CapturedOptions } | undefined;

	beforeEach(() => {
		uploadUrl = `https://uploads.supabase.co/upload/resumable/${randUnique()}`;

		mockUpload = {
			url: uploadUrl,
			start: vi.fn(),
			resumeFromPreviousUpload: vi.fn(),
		};

		// 1. The library is replaced by a recording stand-in, so the options the driver hands it can be asserted
		//    without any request; `start` is driven per test through the callbacks the driver relies on
		vi.mocked(tus.Upload).mockImplementation(((source: Readable, options: CapturedOptions) => {
			captured = { source, options };

			return mockUpload;
		}) as never);
	});

	test('Creates a TUS upload for the chunk and resolves with the advanced offset', async () => {
		const context = { size: sample.file.size, metadata: { contentType: sample.file.type } };

		mockUpload.start.mockImplementation(() => {
			captured!.options.onUploadUrlAvailable();
			captured!.options.onChunkComplete(3, 3, sample.file.size);
		});

		const result = await driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context);

		// 1. The buffered chunk is the library's one-shot source, the endpoint is the resumable URL, and the metadata
		//    names the target: the bucket, the object name under the root and the content type from the client metadata
		expect(tus.Upload).toHaveBeenCalledTimes(1);

		const received: Buffer[] = [];

		for await (const chunk of captured!.source) {
			received.push(chunk as Buffer);
		}

		expect(Buffer.concat(received).toString()).toBe('abc');
		expect(captured!.options.endpoint).toBe(driver['getResumableUrl']());

		expect(captured!.options.metadata).toStrictEqual({
			bucketName: sample.config.bucket,
			objectName: sample.path.input,
			contentType: sample.file.type,
			cacheControl: '3600',
		});

		// 2. The service-role key authorises the upload, `x-upsert` lets a re-upload replace the object, the chunk size
		//    is the configured one, and retries are left to the TUS server in front of this driver
		expect(captured!.options.headers).toStrictEqual({
			Authorization: `Bearer ${sample.config.serviceRole}`,
			'x-upsert': 'true',
		});

		expect(captured!.options.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
		expect(captured!.options.retryDelays).toBeNull();

		// 3. A known size is passed as `uploadSize`; the offset moves by what the chunk callback reports
		expect(captured!.options.uploadSize).toBe(sample.file.size);
		expect(result).toBe(3);
	});

	test('Refuses a deferred length with a named error instead of reaching the library', async () => {
		const context = { size: undefined, metadata: {} };

		// 1. A chunk without a known total can never be forwarded: `tus-js-client` would reject it before any request
		//    with a size-derivation error, so the refusal names the limitation up front, before an upload is created
		await expect(
			driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context),
		).rejects.toThrowError(
			`Cannot write a chunk of "${sample.path.input}": the supabase storage driver does not support deferred-length uploads`,
		);

		expect(tus.Upload).not.toHaveBeenCalled();
	});

	test('Falls back to the generic content type when the client sends none', async () => {
		const context = { size: sample.file.size, metadata: undefined };

		mockUpload.start.mockImplementation(() => {
			captured!.options.onChunkComplete(3, 3, sample.file.size);
		});

		await driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context);

		// 1. A POST without `Upload-Metadata` still produces a valid upload: the content type falls back to a generic
		//    binary type and the known size goes out as `uploadSize`
		expect(captured!.options.metadata?.['contentType']).toBe('application/octet-stream');
		expect(captured!.options.uploadSize).toBe(sample.file.size);
	});

	test('Sends no request for an empty chunk and returns the offset unchanged', async () => {
		const context = { size: sample.file.size, metadata: {} };

		// 1. A zero-length chunk is a no-op, the way the Azure and Cloudinary drivers treat one: `tus-js-client`
		//    would reject the empty one-shot source with a size-mismatch error, so no upload is created and the given
		//    offset comes back
		await expect(driver.writeChunk(sample.path.input, Readable.from([]), 3, context)).resolves.toBe(3);

		expect(tus.Upload).not.toHaveBeenCalled();
	});

	test('Records the upload URL in the context when Supabase assigns one', async () => {
		const context = { size: sample.file.size, metadata: {} };

		mockUpload.start.mockImplementation(() => {
			captured!.options.onUploadUrlAvailable();
			captured!.options.onChunkComplete(0, 0, sample.file.size);
		});

		await driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context);

		// 1. The upload URL is the only handle for appending later chunks, and the creation date is recorded next to
		//    it because resuming an upload reads both
		expect(context.metadata).toStrictEqual({
			'upload-url': uploadUrl,
			creation_date: expect.any(String),
		});
	});

	test('Resumes the upload recorded in the context instead of creating a new one', async () => {
		const creationDate = randPastDate().toString();

		const context = {
			size: sample.file.size,
			metadata: { 'upload-url': uploadUrl, creation_date: creationDate },
		};

		mockUpload.start.mockImplementation(() => {
			captured!.options.onChunkComplete(3, 6, sample.file.size);
		});

		const result = await driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 3, context);

		// 1. Resuming must hand the library its previous-upload literal: the recorded URL and creation date, the same
		//    metadata the upload started with, and no storage key or parallel URLs, since this driver never stores
		//    uploads in a urlStorage
		expect(mockUpload.resumeFromPreviousUpload).toHaveBeenCalledWith({
			size: sample.file.size,
			creationTime: creationDate,
			metadata: captured!.options.metadata,
			uploadUrl,
			urlStorageKey: '',
			parallelUploadUrls: null,
		});

		expect(result).toBe(6);
	});

	test('Gives no creation endpoint when resuming, so an unknown upload fails instead of restarting at 0', async () => {
		const context = {
			size: sample.file.size,
			metadata: { 'upload-url': uploadUrl, creation_date: randPastDate().toString() },
		};

		mockUpload.start.mockImplementation(() => {
			captured!.options.onChunkComplete(3, 6, sample.file.size);
		});

		await driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 3, context);

		// 1. With an endpoint, a 4xx resume HEAD makes the library create a new upload and PATCH this chunk at offset 0
		expect(captured!.options.endpoint).toBeNull();
	});

	test('Returns the offset Supabase acknowledged rather than a computed one', async () => {
		const context = { size: sample.file.size, metadata: {} };

		mockUpload.start.mockImplementation(() => {
			captured!.options.onChunkComplete(3, 2, sample.file.size);
		});

		// 1. Supabase took only two of the three bytes; the TUS server must learn the real offset
		await expect(driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context)).resolves.toBe(2);
	});

	describe('Checks the resumed offset against the chunk offset', () => {
		/**
		 * Drive the resume HEAD through the driver's `onAfterResponse` with the given server offset.
		 *
		 * @param serverOffset - The `Upload-Offset` Supabase answers the HEAD with.
		 * @returns Whether the callback threw, which stops the library before the PATCH.
		 */
		const answerHead = (serverOffset: number) => {
			mockUpload.start.mockImplementation(async () => {
				// 1. The HEAD answer is checked first; a throw is what the library turns into `onError`
				try {
					await captured!.options.onAfterResponse(
						{ getMethod: () => 'HEAD' } as tus.HttpRequest,
						{
							getHeader: (name: string) => (name === 'Upload-Offset' ? String(serverOffset) : undefined),
						} as tus.HttpResponse,
					);
				} catch (error) {
					captured!.options.onError(error as Error);

					return;
				}

				// 2. A matching offset lets the PATCH go out, which then completes the chunk
				captured!.options.onChunkComplete(3, serverOffset + 3, sample.file.size);
			});
		};

		/**
		 * Context of an upload already created by an earlier chunk.
		 *
		 * @returns A context with a recorded upload URL.
		 */
		const resumedContext = () => ({
			size: sample.file.size,
			metadata: { 'upload-url': uploadUrl, creation_date: randPastDate().toString() },
		});

		test('Sends the chunk when Supabase holds the upload at the chunk offset', async () => {
			answerHead(8);

			await expect(
				driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 8, resumedContext()),
			).resolves.toBe(11);
		});

		test('Resolves without resending when an earlier attempt of this chunk already landed', async () => {
			answerHead(11);

			// 1. The response of the first attempt was lost; appending the bytes again would shift every later chunk
			await expect(
				driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 8, resumedContext()),
			).resolves.toBe(11);
		});

		test('Refuses the chunk when Supabase holds the upload at another offset', async () => {
			answerHead(16);

			await expect(
				driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 8, resumedContext()),
			).rejects.toThrowError(`Supabase upload offset 16 does not match chunk offset 8 of "${sample.path.input}"`);
		});
	});

	test('Rejects with the library error when the chunk is rejected', async () => {
		const failure = new Error('tus upload failed');

		const context = { size: sample.file.size, metadata: {} };

		mockUpload.start.mockImplementation(() => {
			captured!.options.onError(failure);
		});

		await expect(driver.writeChunk(sample.path.input, chunkStream(Buffer.from('abc')), 0, context)).rejects.toBe(
			failure,
		);
	});

	test.each([[4], [5]])(
		'Refuses a chunk of %d bytes above the configured size before the upload starts',
		async (bytes) => {
			// 1. A chunk larger than `tus.chunkSize` used to be truncated to the first request and crash the library's
			//    upload loop with a TypeError; it is now refused with the named error the other drivers use, before
			//    `tus-js-client` is involved at all
			const limitedDriver = new StorageDriverSupabase({
				serviceRole: sample.config.serviceRole,
				bucket: sample.config.bucket,
				projectId: sample.config.projectId,
				tus: { chunkSize: 3 },
			});

			const context = { size: sample.file.size, metadata: {} };

			await expect(
				limitedDriver.writeChunk(sample.path.input, chunkStream(Buffer.alloc(bytes, 'a')), 0, context),
			).rejects.toThrowError(`The chunk of ${bytes} bytes exceeds the chunk size limit of 3 bytes`);

			// 2. The refusal happens before the library's upload loop starts, so no TypeError escapes and no upload is
			//    created
			expect(tus.Upload).not.toHaveBeenCalled();
		},
	);
});

describe('#finishChunkedUpload', () => {
	test('Resolves without a request', async () => {
		// 1. Supabase assembles the object itself once the final chunk arrives, so there is nothing to do
		await expect(
			driver.finishChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} }),
		).resolves.toBeUndefined();
	});
});

describe('#deleteChunkedUpload', () => {
	beforeEach(() => {
		// 1. The object removal is watched, so a test can prove the previous version under the final name survives
		driver['bucket'] = { remove: vi.fn().mockResolvedValue({ data: [], error: null }) } as unknown as BucketApi;
	});

	test('Terminates the recorded TUS upload and leaves the object under the final name alone', async () => {
		const uploadUrl = `https://uploads.supabase.co/upload/resumable/${randUnique()}`;

		vi.mocked(tus.Upload.terminate).mockResolvedValue();

		await driver.deleteChunkedUpload(sample.path.input, {
			size: sample.file.size,
			metadata: { 'upload-url': uploadUrl },
		});

		// 1. The unfinished upload has not replaced the object yet, so removing it would delete the previous version
		expect(tus.Upload.terminate).toHaveBeenCalledWith(uploadUrl, {
			headers: { Authorization: `Bearer ${sample.config.serviceRole}` },
			retryDelays: null,
		});

		expect(driver['bucket'].remove).not.toHaveBeenCalled();
	});

	test('Does nothing when no chunk was ever sent', async () => {
		// 1. Without an upload URL nothing exists on Supabase to terminate
		await driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: {} });

		expect(tus.Upload.terminate).not.toHaveBeenCalled();
		expect(driver['bucket'].remove).not.toHaveBeenCalled();
	});

	test.each([404, 410])('Resolves when Supabase answers %i because the upload is already gone', async (status) => {
		// 1. An expired or finished upload has nothing left to abort; the library reports it as a DetailedError
		//    carrying the response
		vi.mocked(tus.Upload.terminate).mockRejectedValue(
			Object.assign(new Error('tus: unexpected response while terminating upload'), {
				originalResponse: { getStatus: () => status },
			}),
		);

		await expect(
			driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: { 'upload-url': 'u' } }),
		).resolves.toBeUndefined();
	});

	test('Rejects with the library error when Supabase refuses the termination', async () => {
		const failure = new Error('tus: unexpected response while terminating upload');

		vi.mocked(tus.Upload.terminate).mockRejectedValue(failure);

		await expect(
			driver.deleteChunkedUpload(sample.path.input, { size: sample.file.size, metadata: { 'upload-url': 'u' } }),
		).rejects.toBe(failure);
	});
});
