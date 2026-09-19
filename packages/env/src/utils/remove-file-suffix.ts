/**
 * Convert a `_FILE` variable name back to the configuration option it stands for.
 *
 * Assumes the caller already checked the suffix with `isFileKey`; the five characters are cut blindly.
 *
 * @param key - Variable name ending in `_FILE`.
 * @returns The name without the suffix.
 * @example
 * ```ts
 * removeFileSuffix('DB_PASSWORD_FILE');
 * // => 'DB_PASSWORD'
 * ```
 */
export const removeFileSuffix = (key: string): string => key.slice(0, -5);
