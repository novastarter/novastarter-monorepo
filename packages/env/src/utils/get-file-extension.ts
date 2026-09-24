import { extname } from 'node:path';

/**
 * Return the lowercased file extension of a path, without the leading period.
 *
 * @param path - File path.
 * @returns The extension, or an empty string when the path has none.
 * @example
 * ```ts
 * getFileExtension('./config.YAML');
 * // => 'yaml'
 * ```
 */
export const getFileExtension = (path: string): string => {
	// Lower-cased so `.JSON` and `.json` pick the same reader; `extname` keeps the dot, so it is dropped
	return extname(path).toLowerCase().substring(1);
};
