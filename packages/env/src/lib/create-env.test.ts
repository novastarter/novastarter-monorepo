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
