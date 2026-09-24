/**
 * Tests of `storage/errors/file-not-found`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { StorageFileNotFoundError } from './file-not-found.js';

test('Carries the code, the status, the path in the message and the backend error as cause', () => {
	const cause = new Error('NoSuchKey');
	const error = new StorageFileNotFoundError({ filepath: 'avatars/1.png' }, { cause });

	// A missing object answers 404: what an API relays as is, what a caller checks for instead of the backend's error
	expect(error.code).toBe('STORAGE_FILE_NOT_FOUND');
	expect(error.status).toBe(404);
	expect(error.message).toBe('The file "avatars/1.png" does not exist');
	expect(error.extensions).toStrictEqual({ filepath: 'avatars/1.png' });
	expect(error.cause).toBe(cause);

	// Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'STORAGE_FILE_NOT_FOUND')).toBe(true);
});
