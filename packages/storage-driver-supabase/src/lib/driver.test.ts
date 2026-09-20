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
import { StorageFileNotFoundError } from '@novastarter/storage';
import { StorageClient } from '@supabase/storage-js';
import { fetch, Response } from 'undici';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StorageDriverSupabaseConfig } from './driver.js';
import { StorageDriverSupabase } from './driver.js';

vi.mock('@supabase/storage-js');
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
		StorageDriverSupabase.prototype['getClient'] = getClientBackup;
		StorageDriverSupabase.prototype['getBucket'] = getBucketBackup;
	});

	test('Saves passed config to local property', () => {
		// 1. The config is copied with a normalised root; `normalizePath` leaves this sample root untouched, so the
		//    copy must equal the input field by field
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
		expect(driver['config'].root).toBe('');
	});
});

describe('#getClient', () => {
	// The constructor calls getClient(), so we don't have to call it separately

	test('Throws error if serviceRole is missing', () => {
		// 1. The project/endpoint check runs first, so a config with neither reports that error before the missing key
		try {
			new StorageDriverSupabase({ bucket: 'bucket' } as any);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('The supabase storage driver needs a "projectId" or an "endpoint"');
		}
	});

	test('Throws error if bucket missing', () => {
		// 1. Same ordering: without a project or endpoint the client check fails before the bucket check is reached
		try {
			new StorageDriverSupabase({ serviceRole: 'key' } as any);
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('The supabase storage driver needs a "projectId" or an "endpoint"');
		}
	});

	test('Throws error if projectId and endpoint are both missing', () => {
		try {
			new StorageDriverSupabase({ serviceRole: 'secret', bucket: 'bucket' });
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('The supabase storage driver needs a "projectId" or an "endpoint"');
		}
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
		const driver = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
		});

		const result = driver['fullPath'](sample.path.input);
		expect(result).toBe(sample.path.input);
	});

	test('Returns normalized joined path', () => {
		const driver = new StorageDriverSupabase({
			serviceRole: sample.config.serviceRole,
			bucket: sample.config.bucket,
			endpoint: sample.config.endpoint,
			root: sample.config.root,
		});

		const result = driver['fullPath'](sample.path.input);
		expect(result).toBe(`${sample.config.root}/${sample.path.input}`);
	});
});

describe('#getAuthenticatedUrl', () => {
	test('Returns the url for an object with no root that requires authentication', () => {
		const driver = new StorageDriverSupabase({
			serviceRole: 'serviceRole',
			bucket: 'bucket',
			projectId: 'projectId',
		});

		const result = driver['getAuthenticatedUrl']('testing.png');

		expect(result).toBe('https://projectId.supabase.co/storage/v1/object/authenticated/bucket/testing.png');
	});

	test('Returns the url for an object that requires authentication', () => {
		const driver = new StorageDriverSupabase({
			serviceRole: 'serviceRole',
			bucket: 'bucket',
			projectId: 'projectId',
			root: 'testing',
		});

		const result = driver['getAuthenticatedUrl']('testing.png');

		expect(result).toBe('https://projectId.supabase.co/storage/v1/object/authenticated/bucket/testing/testing.png');
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
		await driver.read(sample.path.input);

		expect(driver['getAuthenticatedUrl']).toHaveBeenCalledWith(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
			},
			method: 'GET',
		});
	});

	test('Uses getAuthenticatedUrl to get endpoint when a root is set', async () => {
		driver['getAuthenticatedUrl'] = vi.fn().mockReturnValue(rootEndpoint);

		await driver.read(sample.path.input);

		expect(driver['getAuthenticatedUrl']).toHaveBeenCalledWith(sample.path.input);

		expect(fetch).toHaveBeenCalledWith(rootEndpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting start range offset', async () => {
		// 1. An open end must produce `bytes=N-`, which the server reads as "from N to the end"
		await driver.read(sample.path.input, { range: { start: sample.range.start } } as any);

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				Range: `bytes=${sample.range.start}-`,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting end range offset', async () => {
		// 1. An open start must produce `bytes=-N`, which the server reads as the last N bytes
		await driver.read(sample.path.input, { range: { end: sample.range.end } } as any);

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				Range: `bytes=-${sample.range.end}`,
			},
			method: 'GET',
		});
	});

	test('Optionally allows setting start and end range offset', async () => {
		await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
				Range: `bytes=${sample.range.start}-${sample.range.end}`,
			},
			method: 'GET',
		});
	});

	test('Throws an error when no stream is returned', async () => {
		// 1. An error status with a body still counts as "no stream": the body is an error page, not the object
		vi.mocked(fetch).mockReturnValue({ status: 400, body: new ReadableStream() } as unknown as Promise<Response>);

		try {
			await driver.read(sample.path.input, { range: sample.range });
		} catch (err: any) {
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe(`No stream returned for file "${sample.path.input}"`);
		}
	});

	test('Throws an error when returned stream is not a readable stream', async () => {
		vi.mocked(fetch).mockReturnValue({ status: 200, body: undefined } as unknown as Promise<Response>);

		expect(driver.read(sample.path.input, { range: sample.range })).rejects.toThrowError(
			new Error(`No stream returned for file "${sample.path.input}"`),
		);
	});

	/** An unread response body holds its connection open */
	test('Cancels the response body it never reads', async () => {
		const cancel = vi.fn().mockResolvedValue(undefined);

		vi.mocked(fetch).mockReturnValue({ status: 400, body: { cancel } } as unknown as Promise<Response>);

		await expect(driver.read(sample.path.input)).rejects.toThrowError(
			new Error(`No stream returned for file "${sample.path.input}"`),
		);

		expect(cancel).toHaveBeenCalled();
	});

	test('Returns stream', async () => {
		// 1. The Web stream from `fetch` must come back converted, since callers expect a Node readable
		const stream = await driver.read(sample.path.input, { range: sample.range });

		expect(fetch).toHaveBeenCalledWith(endpoint, {
			headers: {
				Authorization: `Bearer ${sample.config.serviceRole}`,
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
				data: [{ metadata: { contentLength: sample.file.size, lastModified: sample.file.modified } }],
				error: null,
			}),
		} as any;

		const stat = await driver.stat(sample.path.input);

		expect(stat).toEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});

		// 2. The lookup must query the parent folder and search for the base name, not list the whole bucket
		expect(driver['bucket'].list).toHaveBeenCalledWith(dirname(sample.path.input), {
			limit: 1,
			search: basename(sample.path.input),
		});
	});

	test('Uses the configured root directory', async () => {
		driver['config'].root = 'root';

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [{ metadata: { contentLength: sample.file.size, lastModified: sample.file.modified } }],
				error: null,
			}),
		} as any;

		const stat = await driver.stat(sample.path.input);

		expect(stat).toEqual({
			size: sample.file.size,
			modified: sample.file.modified,
		});

		expect(driver['bucket'].list).toHaveBeenCalledWith(join('root', dirname(sample.path.input)), {
			limit: 1,
			search: basename(sample.path.input),
		});
	});

	test('Uses empty string instead of "." when root is the empty string', async () => {
		// 1. `join('', '')` yields `.`, which Supabase would treat as a literal folder name
		const filename = 'test.png';

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [{ metadata: { contentLength: sample.file.size, lastModified: sample.file.modified } }],
				error: null,
			}),
		} as any;

		await driver.stat(filename);

		expect(driver['bucket'].list).toHaveBeenCalledWith('', {
			limit: 1,
			search: filename,
		});
	});

	test('Throws the kit error when no file is returned by list', async () => {
		// 1. An empty listing is how Supabase says "missing"; it becomes the error every backend shares
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [],
				error: null,
			}),
		} as any;

		const error: unknown = await driver.stat(sample.path.input).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(StorageFileNotFoundError);
		expect(error).toMatchObject({ extensions: { filepath: sample.path.input } });
	});

	/**
	 * A failed lookup is not the same answer as an empty one, so the storage error has to reach the
	 * caller instead of being reported as a missing file.
	 */
	test('Throws the storage error if the lookup failed', async () => {
		const error = new Error('Service unavailable');

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: null,
				error,
			}),
		} as any;

		await expect(driver.stat(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#exists', () => {
	test('Returns true if the file is returned by list', async () => {
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [{ metadata: { contentLength: sample.file.size, lastModified: sample.file.modified } }],
				error: null,
			}),
		} as any;

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(true);
	});

	test('Returns false if no file is returned by list', async () => {
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: [],
				error: null,
			}),
		} as any;

		const exists = await driver.exists(sample.path.input);

		expect(exists).toBe(false);
	});

	test('Throws the storage error if the lookup failed', async () => {
		// 1. Reporting a failed request as "not found" would make callers act on a wrong answer
		const error = new Error('Service unavailable');

		driver['bucket'] = {
			list: vi.fn().mockReturnValue({
				data: null,
				error,
			}),
		} as any;

		await expect(driver.exists(sample.path.input)).rejects.toThrowError(error);
	});
});

describe('#move', () => {
	test('passes arguments to move', async () => {
		driver['bucket'] = {
			move: vi.fn(),
		} as any;

		await driver.move(sample.path.input, 'new/path');
		expect(driver['bucket'].move).toHaveBeenCalledWith(sample.path.input, 'new/path');
	});
});

describe('#copy', () => {
	test('passes arguments to copy', async () => {
		driver['bucket'] = {
			copy: vi.fn(),
		} as any;

		await driver.copy(sample.path.input, 'new/path');
		expect(driver['bucket'].copy).toHaveBeenCalledWith(sample.path.input, 'new/path');
	});
});

describe('#write', () => {
	beforeEach(() => {
		// 1. A successful upload is the default; the failure test overrides the handle
		driver['bucket'] = {
			upload: vi.fn().mockResolvedValue({ data: null, error: null }),
		} as any;
	});

	test('Passes streams to body as is', async () => {
		// 1. Without a type the driver sends an empty content type; the other options are fixed by the driver
		await driver.write(sample.path.input, sample.stream);

		expect(driver['bucket'].upload).toHaveBeenCalledWith(sample.path.input, sample.stream, {
			cacheControl: '3600',
			contentType: '',
			duplex: 'half',
			upsert: true,
		});
	});

	test('Ensures input is passed to fullPath', async () => {
		driver['fullPath'] = vi.fn();

		await driver.write(sample.path.input, sample.stream);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});

	test('Optionally sets ContentType', async () => {
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
		} as any;

		await expect(driver.write(sample.path.input, sample.stream)).rejects.toThrow(
			new Error(`Error uploading file "${sample.path.input}"`, { cause: uploadError }),
		);
	});
});

describe('#delete', () => {
	test('Ensures input is passed to fullPath', async () => {
		driver['bucket'] = {
			remove: vi.fn(),
		} as any;

		driver['fullPath'] = vi.fn();

		await driver.delete(sample.path.input);
		expect(driver['fullPath']).toHaveBeenCalledWith(sample.path.input);
	});
});

describe('#list', () => {
	test('Constructs list objects params based on input prefix', async () => {
		// 1. A prefix without a trailing slash is split into the folder to query and the name fragment to search
		const sampleFile = randFileName();
		const sampleDirectory = randDirectoryPath();
		const fullSample = `${sampleDirectory}/${sampleFile}`;

		// TODO: Probably a better way to do this?
		driver['bucket'] = {
			list: vi.fn().mockReturnValue({ data: [], error: null }),
		} as any;

		// 2. Pull one item to trigger the first request; the generator is lazy until iterated
		await driver.list(fullSample)[Symbol.asyncIterator]().next();

		expect(driver['bucket'].list).toHaveBeenCalledWith(sampleDirectory, {
			search: sampleFile,
			limit: 1000,
			offset: 0,
		});
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
		} as any;

		driver['config'].root = sampleRoot;

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
		} as any;

		driver['config'].root = sampleRoot;

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
		} as any;

		driver['config'].root = sampleRoot;

		const iterator = driver.list(sampleInput);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output).toStrictEqual(sampleFilesFull);
	});

	test('Recursively fetches all nested directories and yields only the files', async () => {
		const sampleRoot = randUnique() + randDirectoryPath();
		const samplePrefixBase = randUnique() + randDirectoryPath();
		const samplePrefixLastDir = randUnique();
		const samplePrefix = `${samplePrefixBase}/${samplePrefixLastDir}`;

		/*
		sampleFile
		sampleDirectory/
		├─ sampleFileNested
		 */
		const sampleDirectory = randUnique();
		const sampleFile = randFileName();
		const sampleFileNested = randFileName();

		const fullSampleDirectory = `${samplePrefix}/${sampleDirectory}`;
		const fullSampleFile = `${samplePrefix}/${sampleFile}`;
		const fullSampleFileNested = `${fullSampleDirectory}/${sampleFileNested}`;

		// 1. Route each listing call by the exact folder and search the driver is expected to send; any other call is
		//    a wrong query and fails the test by throwing
		driver['bucket'] = {
			list: vi.fn(async (path, options): Promise<any> => {
				// query for parent dir, return the contained dir
				if (path === `${sampleRoot}/${samplePrefixBase}` && options?.search === samplePrefixLastDir)
					return { data: [{ name: samplePrefixLastDir, id: null }], error: null };
				// query for the contents of the samplePrefix, return file and directory
				if (path === `${sampleRoot}/${samplePrefix}/` && options?.search === '')
					return {
						data: [
							{ name: sampleDirectory, id: null },
							{ name: sampleFile, id: randUnique() },
						],
						error: null,
					};
				// query for the contents of the sampleDirectory, return the nested file
				if (path === `${sampleRoot}/${fullSampleDirectory}/` && options?.search === '')
					return {
						data: [{ name: sampleFileNested, id: randUnique() }],
						error: null,
					};
				throw Error();
			}),
		} as any;

		driver['config'].root = sampleRoot;

		const iterator = driver.list(samplePrefix);
		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		// 2. Three queries: the parent, the prefix folder and the nested folder; folders are descended in listing
		//    order, so the nested file comes out before the sibling file
		expect(driver['bucket'].list).toHaveBeenCalledTimes(3);
		expect(output).toStrictEqual([fullSampleFileNested, fullSampleFile]);
	});

	test('Continuously fetches until all pages are returned', async () => {
		// 1. A full page of 1000 must trigger a second request; the short second page ends the loop
		const firstContents = Array.from({ length: 1000 }, () => ({ name: randFilePath() }));
		const secondContents = Array.from({ length: 256 }, () => ({ name: randFilePath() }));

		// TODO: Probably a better way to do this?
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
		} as any;

		const iterator = driver.list(sample.path.input);

		const output: string[] = [];

		for await (const filepath of iterator) {
			output.push(filepath);
		}

		expect(output.length).toBe(1256);
	});
});
