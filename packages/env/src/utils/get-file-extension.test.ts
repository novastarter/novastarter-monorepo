/**
 * Tests of `env/utils/get-file-extension`.
 */
import { extname } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getFileExtension } from './get-file-extension.js';

vi.mock('node:path');

afterEach(() => {
	// A mocked extname leaking into the next test would silently change its assertion
	vi.clearAllMocks();
});

test('Returns lowercased extname without period prefix', () => {
	// An upper-cased extension with a period, so both transformations are proven with one value
	vi.mocked(extname).mockReturnValue('.JPEG');
	const res = getFileExtension('./my-test-file.JPEG');
	expect(extname).toHaveBeenCalledWith('./my-test-file.JPEG');
	expect(res).toBe('jpeg');
});
