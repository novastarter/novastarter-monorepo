/**
 * Tests of `database/lib/ensure-directory`.
 */
import { mkdirSync } from 'node:fs';
import { randDirectoryPath } from '@ngneat/falso';
import { describe, expect, test, vi } from 'vitest';
import { ensureDirectory } from './ensure-directory.js';

vi.mock('node:fs');

describe('ensureDirectory', () => {
	test('Creates the directory recursively', () => {
		const directory = randDirectoryPath();

		ensureDirectory(directory);

		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true });
	});

	test('Lets the filesystem error through', () => {
		const error = new Error('EACCES');

		vi.mocked(mkdirSync).mockImplementationOnce(() => {
			throw error;
		});

		expect(() => ensureDirectory(randDirectoryPath())).toThrow(error);
	});
});
