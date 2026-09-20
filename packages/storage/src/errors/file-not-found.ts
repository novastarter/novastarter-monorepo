import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Context of {@link StorageFileNotFoundError}.
 */
export interface StorageFileNotFoundErrorExtensions {
	/** The object path that was asked for, relative to the driver root. */
	filepath: string;
}

/**
 * Thrown by a driver when there is no object at the path: `ENOENT` on disk, `404` from S3, GCS, Azure or
 * Cloudinary, an empty answer from Supabase.
 *
 * One error for every backend, so a caller can tell "not there" from "the backend is down" without knowing which
 * driver serves the location. Status 404, since that is what it is.
 *
 * @example
 * ```ts
 * try {
 * 	const { size } = await useStorage().location('uploads').stat(path);
 * } catch (error) {
 * 	if (error instanceof StorageFileNotFoundError) return null;
 * 	throw error;
 * }
 * ```
 */
export const StorageFileNotFoundError: NovastarterErrorConstructor<StorageFileNotFoundErrorExtensions> =
	createError<StorageFileNotFoundErrorExtensions>(
		'STORAGE_FILE_NOT_FOUND',
		({ filepath }) => `The file "${filepath}" does not exist`,
		404,
	);
