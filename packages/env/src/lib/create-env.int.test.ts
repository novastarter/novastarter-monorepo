/**
 * Tests of `env/lib/create-env` with its real dependencies.
 */
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { createEnv } from './create-env.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

vi.mock('../utils/get-config-path.js');
vi.mock('../utils/read-configuration-from-process.js');
vi.mock('./read-configuration-from-file.js');
vi.mock('node:fs');

vi.mock('../constants/defaults.js', () => ({
	DEFAULTS: {
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	},
}));

afterEach(() => {
	// 1. resetAllMocks drops the programmed returns of the mocked readers and fs, so each test sets up its own
	vi.resetAllMocks();
});

test('Applies cast prefixes, inline and on file contents, and keeps everything else as given', () => {
	// 1. Inline values in every shape: plain, cast-prefixed, and `_FILE` variables with and without a prefix
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

	// 2. The config file contributes its own values and `_FILE` variables on top of the process environment
	const fileConfigs = {
		FILE1: 'test-file',
		FILE2_FILE: './file.txt',
		FILE3_FILE: 'array:./file.txt',
	};

	// 3. File contents, one read per `_FILE` variable in enumeration order; the prefixes on the paths are peeled off
	//    before the read and re-applied to the content
	vi.mocked(readConfigurationFromProcess).mockReturnValue(processConfigs);
	vi.mocked(readConfigurationFromFile).mockReturnValue(fileConfigs);
	vi.mocked(readFileSync).mockReturnValueOnce('file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('one,two,three');
	vi.mocked(readFileSync).mockReturnValueOnce('ran,d0m,from-file');
	vi.mocked(readFileSync).mockReturnValueOnce('file-from-file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('elem1,elem2');

	// 4. Only the declared file variables are read from disk; a third-party `*_FILE` variable would be left alone
	const env = createEnv({ fileVariables: ['PROCESS5', 'PROCESS6', 'PROCESS8', 'FILE2', 'FILE3'] });

	// 5. Defaults sit under their own names, plain values keep their source's type, and every cast prefix — inline
	//    or on a file reference — is applied to the final value
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
