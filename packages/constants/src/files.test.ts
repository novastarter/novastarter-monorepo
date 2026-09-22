/**
 * Tests of `constants/files`: the values other packages build on.
 */
import { expect, test } from 'vitest';
import { DEFAULT_CHUNK_SIZE, JAVASCRIPT_FILE_EXTS } from './files.js';

test('Lists the JavaScript extensions a config file may have', () => {
	// 1. `@novastarter/env` picks the JS reader by membership in this list, so the members are the contract; the exact literal also pins the documented `@defaultValue`
	expect(JAVASCRIPT_FILE_EXTS).toEqual(['js', 'mjs', 'cjs']);
});

test('Defaults the chunk size to 8 MiB', () => {
	// 1. Storage drivers size their resumable-upload parts by it; a change here changes every upload
	expect(DEFAULT_CHUNK_SIZE).toBe(8 * 1024 * 1024);
});
