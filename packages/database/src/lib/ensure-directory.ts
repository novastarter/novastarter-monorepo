import { mkdirSync } from 'node:fs';

/**
 * Create a directory with its parents, for a database file or data directory that does not exist yet.
 *
 * The file-backed drivers call this before opening: SQLite creates no directories, PGlite creates only the leaf, and
 * a fresh checkout has no `data/` yet. Synchronous, so a bad path fails in the driver's constructor with the
 * filesystem's own error rather than later inside a boot or a query.
 *
 * @param directory - The directory to create; an existing one is left as it is.
 * @throws What `mkdirSync` raised: a file in the way, a parent without write access.
 * @example
 * ```ts
 * ensureDirectory(dirname(config.file));
 * ```
 */
export const ensureDirectory = (directory: string): void => {
	// Recursive, so every missing parent is created too and an existing directory is no error
	mkdirSync(directory, { recursive: true });
};
