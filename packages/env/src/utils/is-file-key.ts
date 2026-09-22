/**
 * Check whether a variable key points to a file that holds the actual value.
 *
 * The length check excludes a bare `_FILE`, which would leave an empty name once the suffix is removed.
 *
 * @param key - Variable name.
 * @returns `true` for names such as `DB_PASSWORD_FILE`.
 */
export const isFileKey = (key: string): boolean => {
	// 1. The length check excludes a bare `_FILE`, which would leave an empty name once the suffix is removed
	return key.length > 5 && key.endsWith('_FILE');
};
