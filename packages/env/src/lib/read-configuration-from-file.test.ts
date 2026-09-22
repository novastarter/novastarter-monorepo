/**
 * Tests of `env/lib/read-configuration-from-file`.
 */
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getFileExtension } from '../utils/get-file-extension.js';
import { readConfigurationFromDotEnv } from '../utils/read-configuration-from-dotenv.js';
import { readConfigurationFromJavaScript } from '../utils/read-configuration-from-javascript.js';
import { readConfigurationFromJson } from '../utils/read-configuration-from-json.js';
import { readConfigurationFromYaml } from '../utils/read-configuration-from-yaml.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

vi.mock('node:fs');
vi.mock('../utils/get-file-extension.js');
vi.mock('../utils/read-configuration-from-dotenv.js');
vi.mock('../utils/read-configuration-from-javascript.js');
vi.mock('../utils/read-configuration-from-json.js');
vi.mock('../utils/read-configuration-from-yaml.js');

beforeEach(() => {
	// 1. Every reader returns a distinctive object, so each test sees at a glance which one was picked
	vi.mocked(readConfigurationFromJavaScript).mockReturnValue({ JS: true });
	vi.mocked(readConfigurationFromJson).mockReturnValue({ JSON: true });
	vi.mocked(readConfigurationFromYaml).mockReturnValue({ YAML: true });
	vi.mocked(readConfigurationFromDotEnv).mockReturnValue({ DOTENV: 'true' });
});

afterEach(() => {
	// 1. resetAllMocks also drops the programmed returns above, so the next test reprograms them from scratch
	vi.resetAllMocks();
});

test('Returns null if file path does not exist', () => {
	// 1. A missing config file is not an error — it means the application runs on the process environment alone
	vi.mocked(existsSync).mockReturnValue(false);

	expect(readConfigurationFromFile('./test/path')).toBe(null);
});

test('Reads JS file if extension is js', () => {
	// 1. The extension alone routes the file, no content sniffing
	vi.mocked(getFileExtension).mockReturnValue('js');

	expect(readConfigurationFromFile('./test/path')).toEqual({ JS: true });
});

test('Reads JSON file if extension is json', () => {
	// 1. JSON is routed to the require-based reader
	vi.mocked(getFileExtension).mockReturnValue('json');

	expect(readConfigurationFromFile('./test/path')).toEqual({ JSON: true });
});

test('Reads yaml file if extension is yaml or yml', () => {
	// 1. Both spellings of the YAML extension route to the same reader
	vi.mocked(getFileExtension).mockReturnValue('yaml');
	expect(readConfigurationFromFile('./test/path')).toEqual({ YAML: true });

	vi.mocked(getFileExtension).mockReturnValue('yml');
	expect(readConfigurationFromFile('./test/path')).toEqual({ YAML: true });
});

test('Reads from dotenv file if extension is unknown or missing', () => {
	// 1. The plain `.env` file has no extension at all; dotenv syntax is the fallback for anything unrecognized
	vi.mocked(getFileExtension).mockReturnValue('');
	expect(readConfigurationFromFile('./test/path')).toEqual({ DOTENV: 'true' });
});
