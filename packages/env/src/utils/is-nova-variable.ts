import { NOVA_VARIABLES_REGEX } from '../constants/nova-variables.js';

/**
 * Check whether a variable name is one Nova reads as configuration.
 *
 * A `_FILE` suffix is stripped before matching, so `DB_PASSWORD_FILE` counts as known because `DB_PASSWORD` is.
 *
 * @param key - Variable name.
 * @returns `true` when the name matches one of {@link NOVA_VARIABLES_REGEX}.
 */
export const isNovaVariable = (key: string): boolean => {
	// 1. Match against the base name, so the file-backed variant of a known option is recognised too
	if (key.endsWith('_FILE')) {
		key = key.slice(0, -5);
	}

	// 2. Any single pattern is enough
	return NOVA_VARIABLES_REGEX.some((regex) => regex.test(key));
};
