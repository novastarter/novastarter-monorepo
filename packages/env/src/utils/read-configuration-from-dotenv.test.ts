/**
 * Tests of `env/utils/read-configuration-from-dotenv`.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { afterEach, expect, test, vi } from 'vitest';
import { readConfigurationFromDotEnv } from './read-configuration-from-dotenv.js';

vi.mock('dotenv');
vi.mock('node:fs');

afterEach(() => {
	// 1. Mocked fs and dotenv must not leak their programmed returns into the next test
	vi.clearAllMocks();
});

test('Reads file contents of path synchronously', () => {
	// 1. The file is read with a blocking call, because configuration is needed before anything async can run
	readConfigurationFromDotEnv('./test/path');
	expect(readFileSync).toHaveBeenCalledWith('./test/path');
});

test('Parses file contents with dotenv', () => {
	// 1. The raw text goes through dotenv's parser rather than a hand-rolled one, so quoting rules match the format
	vi.mocked(readFileSync).mockReturnValue('dotenv-file-contents');
	readConfigurationFromDotEnv('./test/path');
	expect(parse).toHaveBeenCalledWith('dotenv-file-contents');
});

test('Returns parsed dotenv config', () => {
	// 1. Whatever dotenv parsed is the configuration, passed on by reference
	vi.mocked(parse).mockReturnValue({ hello: 'world' });
	expect(readConfigurationFromDotEnv('./test/path')).toEqual({ hello: 'world' });
});
