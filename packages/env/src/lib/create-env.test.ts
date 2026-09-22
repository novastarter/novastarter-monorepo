/**
 * Tests of `env/lib/create-env`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getConfigPath } from '../utils/get-config-path.js';
import { isFileKey } from '../utils/is-file-key.js';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { removeFileSuffix } from '../utils/remove-file-suffix.js';
import { cast } from './cast.js';
import { createEnv } from './create-env.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

vi.mock('../utils/get-config-path.js');
vi.mock('../utils/is-file-key.js');
vi.mock('../utils/read-configuration-from-process.js');
vi.mock('../utils/remove-file-suffix.js');
vi.mock('./cast.js');
vi.mock('./read-configuration-from-file.js');
vi.mock('node:fs');

vi.mock('../constants/defaults.js', () => ({
	DEFAULTS: {
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	},
}));

let processConfig: Record<string, string>;
let fileConfig: Record<string, unknown>;

beforeEach(() => {
	vi.mocked(cast).mockImplementation((value) => value);

	processConfig = { PROCESS: 'test-process' };
	fileConfig = { FILE: 'test-file' };

	vi.mocked(readConfigurationFromProcess).mockReturnValue(processConfig);
	vi.mocked(readConfigurationFromFile).mockReturnValue(fileConfig);
});

afterEach(() => {
	vi.resetAllMocks();
});

test('Takes the defaults as they are, casting the sources only', () => {
	const env = createEnv();

	expect(env).toEqual({
		PROCESS: 'test-process',
		FILE: 'test-file',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});

	// 1. The two source values go through `cast`; the two defaults do not
	expect(cast).toHaveBeenCalledTimes(2);
	expect(cast).toHaveBeenCalledWith('test-process');
	expect(cast).toHaveBeenCalledWith('test-file');
});

test('Names the variable when a cast prefix cannot read its value', () => {
	// 1. The cast knows the value only; the variable is what the reader of the error has to fix
	const cause = new Error('Cannot cast "number:80O0" to a number');

	vi.mocked(cast).mockImplementation((value) => {
		if (value === 'test-process') throw cause;
		return value;
	});

	expect(() => createEnv()).toThrow('Environment variable "PROCESS": Cannot cast "number:80O0" to a number');
});

test('Combines process/file based config with defaults', () => {
	const env = createEnv();

	expect(env).toEqual({
		PROCESS: 'test-process',
		FILE: 'test-file',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Reads file configuration from config path', () => {
	vi.mocked(getConfigPath).mockReturnValue('./test/config/path');

	createEnv();

	expect(readConfigurationFromFile).toHaveBeenCalledWith('./test/config/path');
});

describe('File based configuration', () => {
	beforeEach(() => {
		vi.mocked(isFileKey).mockImplementation((key) => {
			return key === 'PROCESS_FILE';
		});

		vi.mocked(removeFileSuffix).mockReturnValue('PROCESS');
		vi.mocked(readFileSync).mockReturnValue('file-content');
	});

	test('Reads values from file via process value', () => {
		vi.mocked(readConfigurationFromFile).mockReturnValue({});

		vi.mocked(readConfigurationFromProcess).mockReturnValue({
			PROCESS_FILE: './test/path',
		});

		const env = createEnv({ fileVariables: ['PROCESS'] });

		expect(removeFileSuffix).toHaveBeenCalledWith('PROCESS_FILE');
		expect(readFileSync).toHaveBeenCalledWith('./test/path', { encoding: 'utf8' });

		expect(env).toEqual({
			PROCESS: 'file-content',
			DEFAULT: 'test-default',
			DEFAULT_ARRAY: 'one,two,three',
		});
	});

	test('Reads values from file via process value with casting', () => {
		vi.mocked(readConfigurationFromFile).mockReturnValue({});

		vi.mocked(readConfigurationFromProcess).mockReturnValue({
			PROCESS_FILE: 'array:./test/path',
		});

		createEnv({ fileVariables: ['PROCESS'] });

		expect(removeFileSuffix).toHaveBeenCalledWith('PROCESS_FILE');
		expect(readFileSync).toHaveBeenCalledWith('./test/path', { encoding: 'utf8' });
		expect(cast).toHaveBeenCalledWith('array:file-content');
	});

	test('Strips the single trailing newline a mounted-secret file keeps', () => {
		// 1. The file content carries the newline a mounted secret ends with
		vi.mocked(readFileSync).mockReturnValue('file-content\n');

		// 2. The secret comes from the process environment alone
		vi.mocked(readConfigurationFromFile).mockReturnValue({});

		vi.mocked(readConfigurationFromProcess).mockReturnValue({
			PROCESS_FILE: './test/path',
		});

		const env = createEnv({ fileVariables: ['PROCESS'] });

		// 3. The stored value has the newline stripped, matching the inline spelling
		expect(env['PROCESS']).toBe('file-content');
	});

	test('Strips the trailing newline of a `string:`-prefixed file content', async () => {
		// 1. The real cast peels the `string:` prefix, so the test sees the value an application would get
		const { cast: actualCast } = await vi.importActual<typeof import('./cast.js')>('./cast.js');

		vi.mocked(cast).mockImplementation(actualCast);

		// 2. The file content ends in `\r\n`, the newline a mounted secret can carry
		vi.mocked(readFileSync).mockReturnValue('file-content\r\n');
		vi.mocked(readConfigurationFromFile).mockReturnValue({});

		vi.mocked(readConfigurationFromProcess).mockReturnValue({
			PROCESS_FILE: 'string:./test/path',
		});

		const env = createEnv({ fileVariables: ['PROCESS'] });

		// 3. The prefix is re-applied to the stripped content, and casting yields the clean value
		expect(cast).toHaveBeenCalledWith('string:file-content');
		expect(env['PROCESS']).toBe('file-content');
	});
});

test('Applies cast prefixes, inline and on file contents, and keeps everything else as given', async () => {
	// 1. This case reads the interplay of the real pieces — `cast`, the `_FILE` key detection and the suffix
	//    removal — so each runs unmocked for the duration of the test
	const { cast: actualCast } = await vi.importActual<typeof import('./cast.js')>('./cast.js');

	const { isFileKey: actualIsFileKey } =
		await vi.importActual<typeof import('../utils/is-file-key.js')>('../utils/is-file-key.js');

	const { removeFileSuffix: actualRemoveFileSuffix } = await vi.importActual<
		typeof import('../utils/remove-file-suffix.js')
	>('../utils/remove-file-suffix.js');

	vi.mocked(cast).mockImplementation(actualCast);
	vi.mocked(isFileKey).mockImplementation(actualIsFileKey);
	vi.mocked(removeFileSuffix).mockImplementation(actualRemoveFileSuffix);

	// 2. Inline values in every shape: plain, cast-prefixed, and `_FILE` variables with and without a prefix
	const processConfigs = {
		PROCESS1: 'test-process',
		PROCESS2: 'array:one,two',
		PROCESS3: 'one,two,three',
		PROCESS4: 'array:string:hey,number:1',
		PROCESS5_FILE: './file.txt',
		PROCESS6_FILE: 'array:./file.txt',
		PROCESS7: 'string:ran,d0m',
		PROCESS8_FILE: 'string:./file.txt',
	};

	// 3. The config file contributes its own values and `_FILE` variables on top of the process environment
	const fileConfigs = {
		FILE1: 'test-file',
		FILE2_FILE: './file.txt',
		FILE3_FILE: 'array:./file.txt',
	};

	// 4. File contents, one read per `_FILE` variable in enumeration order; the prefixes on the paths are peeled
	//    off before the read and re-applied to the content
	vi.mocked(readConfigurationFromProcess).mockReturnValue(processConfigs);
	vi.mocked(readConfigurationFromFile).mockReturnValue(fileConfigs);
	vi.mocked(readFileSync).mockReturnValueOnce('file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('one,two,three');
	vi.mocked(readFileSync).mockReturnValueOnce('ran,d0m,from-file');
	vi.mocked(readFileSync).mockReturnValueOnce('file-from-file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('elem1,elem2');

	// 5. Only the declared file variables are read from disk; a third-party `*_FILE` variable would be left alone
	const env = createEnv({ fileVariables: ['PROCESS5', 'PROCESS6', 'PROCESS8', 'FILE2', 'FILE3'] });

	// 6. Defaults sit under their own names, plain values keep their source's type, and every cast prefix —
	//    inline or on a file reference — is applied to the final value
	expect(env).toEqual({
		PROCESS1: 'test-process',
		PROCESS2: ['one', 'two'],
		PROCESS3: 'one,two,three',
		PROCESS4: ['hey', 1],
		PROCESS5: 'file-content',
		PROCESS6: ['one', 'two', 'three'],
		PROCESS7: 'ran,d0m',
		PROCESS8: 'ran,d0m,from-file',
		FILE1: 'test-file',
		FILE2: 'file-from-file-content',
		FILE3: ['elem1', 'elem2'],
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Passthrough file variables that are not among the file variables', () => {
	vi.mocked(readConfigurationFromFile).mockReturnValue({
		TEST_FILE: './test/path',
	});

	vi.mocked(isFileKey).mockReturnValue(true);
	vi.mocked(removeFileSuffix).mockReturnValue('TEST');

	const env = createEnv({ fileVariables: ['OTHER'] });

	expect(readFileSync).not.toHaveBeenCalled();

	expect(env).toEqual({
		PROCESS: 'test-process',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
		TEST_FILE: './test/path',
	});
});

test('Throws error if file could not be read', () => {
	vi.mocked(readConfigurationFromFile).mockReturnValue({
		TEST_FILE: './test/path',
	});

	vi.mocked(isFileKey).mockImplementation((key) => {
		return key === 'TEST_FILE';
	});

	vi.mocked(removeFileSuffix).mockReturnValue('TEST');

	// 1. The fs error is what tells the operator why: its code and path must survive as the cause, its text in the message
	const refusal = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

	vi.mocked(readFileSync).mockImplementation(() => {
		throw refusal;
	});

	expect(() => createEnv({ fileVariables: ['TEST'] })).toThrow(
		expect.objectContaining({
			message:
				'Failed to read value from file "./test/path", defined in environment variable "TEST_FILE": EACCES: permission denied',
			cause: refusal,
		}),
	);
});

test('Names the file path, not the cast-prefixed value, when a prefixed file variable cannot be read', () => {
	vi.mocked(readConfigurationFromFile).mockReturnValue({
		TEST_FILE: 'array:./test/path',
	});

	vi.mocked(isFileKey).mockImplementation((key) => {
		return key === 'TEST_FILE';
	});

	vi.mocked(removeFileSuffix).mockReturnValue('TEST');

	// 1. The cast prefix belongs to the value, not the path; the operator must see the path that was actually read
	const refusal = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });

	vi.mocked(readFileSync).mockImplementation(() => {
		throw refusal;
	});

	expect(() => createEnv({ fileVariables: ['TEST'] })).toThrow(
		expect.objectContaining({
			message:
				'Failed to read value from file "./test/path", defined in environment variable "TEST_FILE": ENOENT: no such file or directory',
			cause: refusal,
		}),
	);
});

test('Refuses a variable set both inline and through its `_FILE` twin, whichever comes first', () => {
	vi.mocked(isFileKey).mockImplementation((key) => {
		return key === 'TEST_FILE';
	});

	vi.mocked(removeFileSuffix).mockReturnValue('TEST');

	// 1. The two orders stand for the two `environ` orders a deployment may pass; both must fail the same way, and
	//    before any file is touched, so no secret is read only to be thrown away
	const pairs = [
		{ TEST: 'inline', TEST_FILE: './test/path' },
		{ TEST_FILE: './test/path', TEST: 'inline' },
	];

	for (const pair of pairs) {
		vi.mocked(readConfigurationFromFile).mockReturnValue({});
		vi.mocked(readConfigurationFromProcess).mockReturnValue(pair);

		expect(() => createEnv({ fileVariables: ['TEST'] })).toThrow(
			'Environment variables "TEST" and "TEST_FILE" are both set; keep one of them.',
		);
	}

	// 2. The pair is refused across sources too: an inline value in the process and a path in the config file
	vi.mocked(readConfigurationFromProcess).mockReturnValue({ TEST: 'inline' });
	vi.mocked(readConfigurationFromFile).mockReturnValue({ TEST_FILE: './test/path' });

	expect(() => createEnv({ fileVariables: ['TEST'] })).toThrow(
		'Environment variables "TEST" and "TEST_FILE" are both set; keep one of them.',
	);

	expect(readFileSync).not.toHaveBeenCalled();
});

test('Lets a `_FILE` variable override a default of the same name', () => {
	// 1. Defaults are the floor every source overrides, so a mounted secret next to a default is no conflict
	vi.mocked(isFileKey).mockImplementation((key) => {
		return key === 'DEFAULT_FILE';
	});

	vi.mocked(removeFileSuffix).mockReturnValue('DEFAULT');
	vi.mocked(readFileSync).mockReturnValue('file-content');
	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(readConfigurationFromProcess).mockReturnValue({ DEFAULT_FILE: './test/path' });

	const env = createEnv({ fileVariables: ['DEFAULT'] });

	expect(env['DEFAULT']).toBe('file-content');
});

test('Casts regular values', () => {
	vi.mocked(cast).mockImplementation((value) => `cast-${value}`);

	const env = createEnv();

	expect(env).toEqual({
		PROCESS: 'cast-test-process',
		FILE: 'cast-test-file',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});
